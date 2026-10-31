#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YANIS - Etape 1 : la grande bibliotheque hippique (version GitHub).

Recupere le programme, les partants et les rapports PMU, jour par jour,
et range chaque journee dans un petit fichier compresse :
    donnees/AAAA/MM/AAAA-MM-JJ.json.gz
Ces fichiers ne sont jamais effaces. Apres chaque passage, BILAN.md resume
ce que contient la bibliotheque (lisible directement sur GitHub).

Aucune bibliotheque a installer : Python 3.9+ suffit.

Commandes :
  python yanis.py test                    verifie que le PMU repond
  python yanis.py collecte --budget 25    hier + aujourd'hui, puis l'historique pendant 25 min
  python yanis.py jour 2026-10-30         collecte une date precise
  python yanis.py bilan                   reecrit BILAN.md
"""

import argparse
import datetime as dt
import gzip
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # pas de base de fuseaux : on garde l'heure de la machine
    PARIS = None


def aujourdhui():
    """Date du jour a Paris, meme si le serveur est regle sur une autre heure."""
    return dt.datetime.now(PARIS).date() if PARIS else dt.date.today()

DOSSIER = os.path.dirname(os.path.abspath(__file__))
DONNEES = os.environ.get("YANIS_DONNEES", os.path.join(DOSSIER, "donnees"))
ANNEES = float(os.environ.get("YANIS_ANNEES", "10"))
PAUSE = float(os.environ.get("YANIS_PAUSE", "0.4"))  # secondes entre deux appels, pour rester poli

SOURCES = [
    "https://online.turfinfo.api.pmu.fr/rest/client/7",
    "https://online.turfinfo.api.pmu.fr/rest/client/1",
    "https://offline.turfinfo.api.pmu.fr/rest/client/7",
]
ENTETES = {"User-Agent": "Mozilla/5.0 (Linux; Android) yanis-perso/1.0", "Accept": "application/json"}


# --------------------------------------------------------------------------
# Petits outils
# --------------------------------------------------------------------------

def g(d, *chemins, defaut=None):
    """Lit d['a']['b'] sans planter. Plusieurs chemins possibles, separes en tuples ou en 'a.b'."""
    for chemin in chemins:
        v = d
        for cle in chemin.split("."):
            if isinstance(v, dict) and cle in v:
                v = v[cle]
            else:
                v = None
                break
        if v is not None:
            return v
    return defaut


def ms_vers_texte(ms):
    if not isinstance(ms, (int, float)):
        return None
    try:
        return dt.datetime.fromtimestamp(ms / 1000, PARIS).strftime("%Y-%m-%d %H:%M")
    except (OverflowError, OSError, ValueError):
        return None


def ms_vers_secondes(ms):
    return round(ms / 1000, 2) if isinstance(ms, (int, float)) else None


def jour_pmu(jour):
    return jour.strftime("%d%m%Y")


# --------------------------------------------------------------------------
# Base de donnees
# --------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS reunions (
    date TEXT, r INTEGER, hippodrome_code TEXT, hippodrome TEXT, pays TEXT,
    meteo_temperature REAL, meteo_vent TEXT, meteo_ciel TEXT, nature TEXT,
    PRIMARY KEY (date, r)
);
CREATE TABLE IF NOT EXISTS courses (
    date TEXT, r INTEGER, c INTEGER, libelle TEXT, depart TEXT,
    discipline TEXT, specialite TEXT, distance INTEGER, corde TEXT, parcours TEXT,
    terrain TEXT, penetrometre TEXT, allocation INTEGER, partants INTEGER,
    categorie TEXT, conditions TEXT, condition_sexe TEXT, statut TEXT, arrivee TEXT,
    PRIMARY KEY (date, r, c)
);
CREATE TABLE IF NOT EXISTS partants (
    date TEXT, r INTEGER, c INTEGER, num INTEGER, nom TEXT, statut TEXT,
    age INTEGER, sexe TEXT, race TEXT, pere TEXT, mere TEXT,
    driver TEXT, entraineur TEXT, proprietaire TEXT, eleveur TEXT,
    musique TEXT, nb_courses INTEGER, nb_victoires INTEGER, nb_places INTEGER,
    gains_carriere INTEGER, gains_annee INTEGER,
    deferre TEXT, oeilleres TEXT, recul_m INTEGER, poids_kg REAL, place_corde INTEGER,
    cote_reference REAL, cote_finale REAL,
    place_arrivee INTEGER, temps_s REAL, reduction_km_s REAL, incident TEXT,
    PRIMARY KEY (date, r, c, num)
);
CREATE TABLE IF NOT EXISTS rapports (
    date TEXT, r INTEGER, c INTEGER, pari TEXT, libelle TEXT, combinaison TEXT,
    rapport_pour_1e REAL, mise_base REAL, gagnants REAL,
    PRIMARY KEY (date, r, c, pari, libelle, combinaison)
);
CREATE INDEX IF NOT EXISTS i_partants_nom ON partants(nom);
CREATE INDEX IF NOT EXISTS i_partants_driver ON partants(driver);
CREATE INDEX IF NOT EXISTS i_partants_entraineur ON partants(entraineur);
"""


TABLES = ["reunions", "courses", "partants", "rapports"]


def base_vide():
    con = sqlite3.connect(":memory:")
    con.executescript(SCHEMA)
    return con


def inserer(con, table, ligne):
    cols = ",".join(ligne)
    trous = ",".join("?" * len(ligne))
    con.execute(f"INSERT OR REPLACE INTO {table} ({cols}) VALUES ({trous})", list(ligne.values()))


# --------------------------------------------------------------------------
# Acces au PMU
# --------------------------------------------------------------------------

class PMU:
    def __init__(self):
        self.source = None  # la premiere adresse qui repond est gardee

    def _get(self, url):
        for essai in range(4):
            try:
                req = urllib.request.Request(url, headers=ENTETES)
                with urllib.request.urlopen(req, timeout=30) as rep:
                    corps = rep.read()
                time.sleep(PAUSE)
                if not corps:
                    return None
                return json.loads(corps.decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code in (204, 400, 404):
                    return None
                attente = 5 * (essai + 1)
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
                attente = 5 * (essai + 1)
            print(f"   ... le PMU ne repond pas, nouvel essai dans {attente} s")
            time.sleep(attente)
        return None

    def appel(self, suffixe):
        sources = [self.source] if self.source else SOURCES
        for base in sources:
            donnees = self._get(f"{base}/{suffixe}")
            if donnees is not None:
                self.source = base
                return donnees
        return None

    def programme(self, jour):
        return self.appel(f"programme/{jour_pmu(jour)}")

    def participants(self, jour, r, c):
        return self.appel(f"programme/{jour_pmu(jour)}/R{r}/C{c}/participants")

    def rapports(self, jour, r, c):
        return self.appel(f"programme/{jour_pmu(jour)}/R{r}/C{c}/rapports-definitifs")


# --------------------------------------------------------------------------
# Lecture des reponses PMU -> lignes de la base
# --------------------------------------------------------------------------

def lire_programme(con, date, prog, france_seulement):
    """Range reunions et courses. Renvoie la liste des (r, c) a detailler."""
    reunions = g(prog, "programme.reunions", "reunions", defaut=[]) or []
    a_detailler = []
    for reu in reunions:
        pays = g(reu, "pays.code", "pays.libelle")
        if france_seulement and pays not in (None, "FRA", "FRANCE"):
            continue
        r = g(reu, "numOfficiel", "numExterne", "numReunion")
        if r is None:
            continue
        inserer(con, "reunions", {
            "date": date, "r": r,
            "hippodrome_code": g(reu, "hippodrome.code"),
            "hippodrome": g(reu, "hippodrome.libelleCourt", "hippodrome.libelleLong"),
            "pays": pays,
            "meteo_temperature": g(reu, "meteo.temperature"),
            "meteo_vent": " ".join(str(x) for x in [g(reu, "meteo.forceVent"), g(reu, "meteo.directionVent")] if x is not None) or None,
            "meteo_ciel": g(reu, "meteo.nebulositeLibelleCourt", "meteo.nebulositeLibelleLong"),
            "nature": g(reu, "nature"),
        })
        for co in g(reu, "courses", defaut=[]) or []:
            c = g(co, "numOrdre", "numExterne")
            if c is None:
                continue
            arrivee = g(co, "ordreArrivee")
            inserer(con, "courses", {
                "date": date, "r": r, "c": c,
                "libelle": g(co, "libelle", "libelleCourt"),
                "depart": ms_vers_texte(g(co, "heureDepart")),
                "discipline": g(co, "discipline"),
                "specialite": g(co, "specialite"),
                "distance": g(co, "distance"),
                "corde": g(co, "corde"),
                "parcours": g(co, "parcours"),
                "terrain": g(co, "penetrometre.intitule", "etatTerrain"),
                "penetrometre": g(co, "penetrometre.valeurMesure"),
                "allocation": g(co, "montantPrix", "montantTotalOffert"),
                "partants": g(co, "nombreDeclaresPartants"),
                "categorie": g(co, "categorieParticuliere", "categorieStatut"),
                "conditions": g(co, "conditions"),
                "condition_sexe": g(co, "conditionSexe"),
                "statut": g(co, "statut", "categorieStatut"),
                "arrivee": "-".join(str(x[0] if isinstance(x, list) and x else x) for x in arrivee) if isinstance(arrivee, list) else None,
            })
            a_detailler.append((r, c))
    return a_detailler


def lire_participants(con, date, r, c, donnees):
    liste = g(donnees, "participants", defaut=[]) if isinstance(donnees, dict) else donnees
    for p in liste or []:
        num = g(p, "numPmu", "numero")
        if num is None:
            continue
        inserer(con, "partants", {
            "date": date, "r": r, "c": c, "num": num,
            "nom": g(p, "nom"),
            "statut": g(p, "statut"),
            "age": g(p, "age"),
            "sexe": g(p, "sexe"),
            "race": g(p, "race"),
            "pere": g(p, "nomPere"),
            "mere": g(p, "nomMere"),
            "driver": g(p, "driver", "jockey"),
            "entraineur": g(p, "entraineur"),
            "proprietaire": g(p, "proprietaire"),
            "eleveur": g(p, "eleveur"),
            "musique": g(p, "musique"),
            "nb_courses": g(p, "nombreCourses"),
            "nb_victoires": g(p, "nombreVictoires"),
            "nb_places": g(p, "nombrePlaces"),
            "gains_carriere": g(p, "gainsParticipant.gainsCarriere"),
            "gains_annee": g(p, "gainsParticipant.gainsAnneeEnCours"),
            "deferre": g(p, "deferre"),
            "oeilleres": g(p, "oeilleres"),
            "recul_m": g(p, "handicapDistance"),
            "poids_kg": (lambda v: v / 10 if isinstance(v, (int, float)) and v > 200 else v)(
                g(p, "handicapPoids", "poidsConditionMonte")),
            "place_corde": g(p, "placeCorde"),
            "cote_reference": g(p, "dernierRapportReference.rapport"),
            "cote_finale": g(p, "dernierRapportDirect.rapport"),
            "place_arrivee": g(p, "ordreArrivee"),
            "temps_s": ms_vers_secondes(g(p, "tempsObtenu")),
            "reduction_km_s": ms_vers_secondes(g(p, "reductionKilometrique")),
            "incident": g(p, "incident"),
        })


def lire_rapports(con, date, r, c, donnees):
    blocs = donnees if isinstance(donnees, list) else g(donnees, "rapports", defaut=[]) or []
    for bloc in blocs:
        pari = g(bloc, "typePari")
        mise = g(bloc, "miseBase")
        for rap in g(bloc, "rapports", defaut=[]) or []:
            pour1 = g(rap, "dividendePourUnEuro")
            inserer(con, "rapports", {
                "date": date, "r": r, "c": c, "pari": pari,
                "libelle": g(rap, "libelle", defaut=""),
                "combinaison": str(g(rap, "combinaison", defaut="")),
                "rapport_pour_1e": pour1 / 100 if isinstance(pour1, (int, float)) else None,
                "mise_base": mise / 100 if isinstance(mise, (int, float)) else None,
                "gagnants": g(rap, "nombreGagnants"),
            })


# --------------------------------------------------------------------------
# Fichiers du jour
# --------------------------------------------------------------------------

def chemin_jour(jour):
    return os.path.join(DONNEES, f"{jour:%Y}", f"{jour:%m}", f"{jour.isoformat()}.json.gz")


def ecrire_jour(jour, contenu):
    p = chemin_jour(jour)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(contenu, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, p)


def lire_jour(chemin):
    with gzip.open(chemin, "rt", encoding="utf-8") as f:
        return json.load(f)


def collecter_jour(pmu, jour, france_seulement=True):
    """Collecte une journee et ecrit son fichier. Renvoie un petit texte de resultat."""
    con = base_vide()
    date = jour.isoformat()
    prog = pmu.programme(jour)
    contenu = {"date": date, "collecte_le": dt.datetime.now(PARIS).isoformat(timespec="seconds"),
               "final": jour < aujourdhui() - dt.timedelta(days=1)}
    if prog is None:
        if jour >= aujourdhui() - dt.timedelta(days=1):
            return "pas de programme (pas ecrit, on reessaiera)"
        contenu["vide"] = True
        ecrire_jour(jour, contenu)
        return "aucune course"
    courses = lire_programme(con, date, prog, france_seulement)
    for r, c in courses:
        part = pmu.participants(jour, r, c)
        if part is not None:
            lire_participants(con, date, r, c, part)
        rap = pmu.rapports(jour, r, c)
        if rap is not None:
            lire_rapports(con, date, r, c, rap)
    for t in TABLES:
        cur = con.execute(f"SELECT * FROM {t}")
        cols = [d[0] for d in cur.description]
        contenu[t] = {"colonnes": cols, "lignes": [list(x) for x in cur.fetchall()]}
    ecrire_jour(jour, contenu)
    return f"{len(courses)} courses"


def deja_fait(jour):
    p = chemin_jour(jour)
    if not os.path.exists(p):
        return False
    try:
        return bool(lire_jour(p).get("final") or lire_jour(p).get("vide"))
    except Exception:
        return False


# --------------------------------------------------------------------------
# Commandes
# --------------------------------------------------------------------------

def cmd_test(args):
    pmu = PMU()
    prog = pmu.programme(aujourdhui())
    if prog is None:
        print("ECHEC : le PMU ne repond pas.")
        sys.exit(1)
    reunions = g(prog, "programme.reunions", "reunions", defaut=[]) or []
    nb = sum(len(g(x, "courses", defaut=[]) or []) for x in reunions)
    print(f"OK : le PMU repond ({pmu.source}). Aujourd'hui : {len(reunions)} reunions, {nb} courses.")


def cmd_jour(args):
    pmu = PMU()
    jour = dt.date.fromisoformat(args.date)
    print(f"{jour} : {collecter_jour(pmu, jour, not args.monde)}")


def cmd_collecte(args):
    pmu, t0 = PMU(), time.time()
    limite = t0 + args.budget * 60
    auj = aujourdhui()
    # 1. Le present : avant-hier, hier et aujourd'hui sont toujours mis a jour
    for k in (2, 1, 0):
        jour = auj - dt.timedelta(days=k)
        if not deja_fait(jour):
            print(f"{jour} : {collecter_jour(pmu, jour, not args.monde)}", flush=True)
    # 2. Le passe : on remonte jusqu'a 10 ans tant qu'il reste du temps
    debut = auj - dt.timedelta(days=int(365.25 * ANNEES))
    jour, n = auj - dt.timedelta(days=3), 0
    while jour >= debut and time.time() < limite:
        if not deja_fait(jour):
            print(f"{jour} : {collecter_jour(pmu, jour, not args.monde)}", flush=True)
            n += 1
        jour -= dt.timedelta(days=1)
    print(f"Historique : {n} jours ajoutes en {(time.time() - t0) / 60:.1f} min.")
    cmd_bilan(args)


def charger_tout():
    """Recharge toute la bibliotheque dans une base en memoire, pour les analyses."""
    con = base_vide()
    jours = vides = 0
    for racine, _, fichiers in os.walk(DONNEES):
        for nom in fichiers:
            if not nom.endswith(".json.gz"):
                continue
            d = lire_jour(os.path.join(racine, nom))
            jours += 1
            if d.get("vide"):
                vides += 1
                continue
            for t in TABLES:
                bloc = d.get(t)
                if bloc and bloc["lignes"]:
                    cols = ",".join(bloc["colonnes"])
                    trous = ",".join("?" * len(bloc["colonnes"]))
                    con.executemany(f"INSERT OR REPLACE INTO {t} ({cols}) VALUES ({trous})", bloc["lignes"])
    return con, jours, vides


def cmd_bilan(args):
    con, jours, vides = charger_tout()
    q = lambda sql: con.execute(sql).fetchone()[0]
    l = ["# Bilan de la bibliotheque de Yanis", "",
         f"Mis a jour le {dt.datetime.now(PARIS):%d/%m/%Y a %H:%M}.", "",
         "| | |", "|---|---|",
         f"| Jours collectes | {jours} (dont {vides} sans course) |",
         f"| Periode | {q('SELECT MIN(date) FROM courses')} au {q('SELECT MAX(date) FROM courses')} |",
         f"| Reunions | {q('SELECT COUNT(*) FROM reunions')} |",
         f"| Courses | {q('SELECT COUNT(*) FROM courses')} |",
         f"| Partants | {q('SELECT COUNT(*) FROM partants')} |",
         f"| Rapports | {q('SELECT COUNT(*) FROM rapports')} |",
         f"| Partants avec cote finale | {q('SELECT COUNT(*) FROM partants WHERE cote_finale IS NOT NULL')} |",
         f"| Partants avec place a l'arrivee | {q('SELECT COUNT(*) FROM partants WHERE place_arrivee IS NOT NULL')} |",
         "", "## Courses par discipline", "", "| Discipline | Courses |", "|---|---|"]
    for d, n in con.execute("SELECT discipline, COUNT(*) FROM courses GROUP BY 1 ORDER BY 2 DESC"):
        l.append(f"| {d or '?'} | {n} |")
    l += ["", "## Drivers et jockeys qui gagnent le plus (50 courses minimum)", "",
          "| Nom | Courses | Victoires | % gagnant | % podium |", "|---|---|---|---|---|"]
    sql = """SELECT driver, COUNT(*) n, SUM(place_arrivee=1),
                    ROUND(100.0*SUM(place_arrivee=1)/COUNT(*),1),
                    ROUND(100.0*SUM(place_arrivee BETWEEN 1 AND 3)/COUNT(*),1)
             FROM partants WHERE driver IS NOT NULL AND place_arrivee IS NOT NULL
             GROUP BY driver HAVING n >= 50 ORDER BY 3 DESC LIMIT 15"""
    for row in con.execute(sql):
        l.append("| " + " | ".join(str(x) for x in row) + " |")
    texte = "\n".join(l) + "\n"
    with open(os.path.join(DOSSIER, "BILAN.md"), "w", encoding="utf-8") as f:
        f.write(texte)
    print(texte)


def main():
    ap = argparse.ArgumentParser(description="Yanis - bibliotheque hippique (etape 1)")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("test").set_defaults(f=cmd_test)
    p = sp.add_parser("collecte"); p.add_argument("--budget", type=float, default=25); p.add_argument("--monde", action="store_true"); p.set_defaults(f=cmd_collecte)
    p = sp.add_parser("jour"); p.add_argument("date"); p.add_argument("--monde", action="store_true"); p.set_defaults(f=cmd_jour)
    sp.add_parser("bilan").set_defaults(f=cmd_bilan)
    args = ap.parse_args()
    args.f(args)


if __name__ == "__main__":
    main()
