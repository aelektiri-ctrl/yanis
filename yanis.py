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
  python yanis.py publier                 prepare les donnees de l'appli (docs/data)
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
    categorie TEXT, conditions TEXT, condition_sexe TEXT, statut TEXT, arrivee TEXT, paris TEXT,
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
        self.panne = False  # vrai si le PMU est injoignable (et pas simplement "pas de donnees")

    def _get(self, url):
        for essai in range(4):
            try:
                req = urllib.request.Request(url, headers=ENTETES)
                with urllib.request.urlopen(req, timeout=30) as rep:
                    corps = rep.read()
                time.sleep(PAUSE)
                self.panne = False
                if not corps:
                    return None
                return json.loads(corps.decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code in (204, 400, 404):
                    self.panne = False
                    return None
                attente = 5 * (essai + 1)
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
                attente = 5 * (essai + 1)
            print(f"   ... le PMU ne repond pas, nouvel essai dans {attente} s")
            time.sleep(attente)
        self.panne = True
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

    def performances(self, jour, r, c):
        return self.appel(f"programme/{jour_pmu(jour)}/R{r}/C{c}/performances-detaillees/pretty")

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
            # paris proposes sur cette course (liste vide = course sans paris, on ne peut pas jouer)
            liste_paris = g(co, "paris")
            if isinstance(liste_paris, list):
                types = sorted({str(g(x, "typePari", "codePari") or "") for x in liste_paris if isinstance(x, dict)} - {""})
                paris_txt = ",".join(types)
            else:
                paris_txt = None   # information absente : on ne masque pas
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
                "paris": paris_txt,
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

class PMUEnPanne(Exception):
    """Le PMU ne repond plus : on arrete proprement, sans rien marquer comme vide."""


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
        if pmu.panne:
            raise PMUEnPanne()
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
    try:
        _collecte(pmu, t0, limite, auj, args)
    except PMUEnPanne:
        print("Le PMU ne repond plus : arret propre, on reprendra au prochain passage.")
    cmd_bilan(args)


ECARTS_MOTS = {"nez": 0.05, "courte tete": 0.1, "courte tête": 0.1, "tete": 0.2, "tête": 0.2,
               "courte encolure": 0.25, "encolure": 0.3, "dead-heat": 0.0, "loin": 30.0}


def longueurs(raw):
    """'1 L 1/4' -> 1.25 ; '3/4 L' -> 0.75 ; 'Encolure' -> 0.3 ; inconnu -> None."""
    if not raw:
        return None
    t = raw.strip().lower()
    if t in ECARTS_MOTS:
        return ECARTS_MOTS[t]
    import re
    m = re.match(r"^(?:(\d+)\s*l)?\s*(?:(\d+)/(\d+))?\s*(?:l)?$", t)
    if not m or not (m.group(1) or m.group(2)):
        return None
    v = float(m.group(1) or 0)
    if m.group(2):
        v += int(m.group(2)) / int(m.group(3))
    return v


def resumer_performances(donnees, jour):
    """Resume compact par cheval de ses dernieres courses (connues AVANT la course du jour)."""
    out = {}
    for cle_course, bloc in (donnees or {}).items():
        res_course = {}
        for p in (bloc or {}).get("participants", []) or []:
            num = p.get("numPmu")
            passees = [cc for cc in (p.get("coursesCourues") or [])
                       if isinstance(cc.get("date"), (int, float)) and dt.datetime.fromtimestamp(cc["date"] / 1000).date() < jour]
            if num is None or not passees:
                continue
            places, retards, longs, allocs, dq = [], [], [], [], 0
            for cc in passees:
                parts = cc.get("participants") or []
                lui = next((q for q in parts if q.get("itsHim")), None)
                if not lui:
                    continue
                nb = cc.get("nbParticipants") or len(parts) or 10
                pl = (lui.get("place") or {}).get("place")
                statut = (lui.get("place") or {}).get("statusArrivee") or ""
                if "DISQUALIFIE" in statut:
                    dq += 1
                places.append(pl if isinstance(pl, int) and pl > 0 else nb)
                if cc.get("allocation"):
                    allocs.append(cc["allocation"])
                rks = [q.get("reductionKilometrique") for q in parts if q.get("reductionKilometrique")]
                if lui.get("reductionKilometrique") and rks:
                    retards.append((lui["reductionKilometrique"] - min(rks)) / 1000)
                if isinstance(pl, int) and pl > 0:
                    cumul, ok = 0.0, True
                    for q in sorted(parts, key=lambda q: ((q.get("place") or {}).get("place") or 99)):
                        qp = (q.get("place") or {}).get("place")
                        if not isinstance(qp, int) or qp < 2 or qp > pl:
                            continue
                        lg = longueurs((q.get("distanceAvecPrecedent") or {}).get("rawValue"))
                        if lg is None:
                            ok = False
                            break
                        cumul += lg
                    if ok and pl > 1:
                        longs.append(min(cumul, 30.0))
                    elif pl == 1:
                        longs.append(0.0)
            if not places:
                continue
            derniere = max(cc["date"] for cc in passees)
            moy = lambda l: round(sum(l) / len(l), 3) if l else None
            res_course[str(num)] = {
                "n": len(places), "place_moy": moy(places), "top3": round(sum(1 for x in places if x <= 3) / len(places), 3),
                "vict": sum(1 for x in places if x == 1), "dq": round(dq / len(places), 3),
                "retard_km_moy": moy(retards), "retard_km_min": round(min(retards), 3) if retards else None,
                "long_moy": moy(longs), "long_min": round(min(longs), 3) if longs else None,
                "alloc_moy": moy(allocs), "alloc_max": max(allocs) if allocs else None,
                "jours": (jour - dt.datetime.fromtimestamp(derniere / 1000).date()).days,
            }
        if res_course:
            out[cle_course] = res_course
    return out


def chemin_resume_perf(jour):
    return os.path.join(DOSSIER, "donnees_perf_resume", f"{jour:%Y}", f"{jour:%m}", f"{jour.isoformat()}.json.gz")


def collecter_performances(pmu, jour, garder_brut=False):
    """Performances detaillees des partants. On garde toujours le RESUME compact (pour le modele) ;
    le detail complet seulement pour aujourd'hui, 10 jours (fichiers lourds)."""
    p = chemin_jour(jour)
    if not os.path.exists(p):
        return 0
    jour_data = lire_jour(p)
    if jour_data.get("vide"):
        return 0
    courses = jour_data.get("courses", {}).get("lignes", [])
    sortie, n = {}, 0
    for ligne in courses:
        r, c = ligne[1], ligne[2]
        d = pmu.performances(jour, r, c)
        if d is not None:
            sortie[f"R{r}C{c}"] = d
            n += 1
    if not sortie:
        return 0
    cr = chemin_resume_perf(jour)
    os.makedirs(os.path.dirname(cr), exist_ok=True)
    with gzip.open(cr, "wt", encoding="utf-8") as f:
        json.dump(resumer_performances(sortie, jour), f, ensure_ascii=False, separators=(",", ":"))
    if garder_brut:
        dossier = os.path.join(DOSSIER, "donnees_perf")
        os.makedirs(dossier, exist_ok=True)
        with gzip.open(os.path.join(dossier, f"{jour.isoformat()}.json.gz"), "wt", encoding="utf-8") as f:
            json.dump(sortie, f, ensure_ascii=False, separators=(",", ":"))
        for nom in os.listdir(dossier):
            try:
                if (aujourdhui() - dt.date.fromisoformat(nom[:10])).days > 10:
                    os.remove(os.path.join(dossier, nom))
            except ValueError:
                pass
    return n


def cmd_perfs(args):
    """Rattrapage : performances detaillees des jours deja en bibliotheque, du plus recent au plus ancien."""
    pmu, limite = PMU(), time.time() + args.budget * 60
    jour, faits = aujourdhui() - dt.timedelta(days=1), 0
    debut = aujourdhui() - dt.timedelta(days=int(365.25 * ANNEES))
    try:
        while jour >= debut and time.time() < limite:
            if os.path.exists(chemin_jour(jour)) and not os.path.exists(chemin_resume_perf(jour)):
                n = collecter_performances(pmu, jour)
                print(f"{jour} : performances de {n} courses", flush=True)
                faits += 1
            jour -= dt.timedelta(days=1)
    except PMUEnPanne:
        print("Le PMU ne repond plus : on reprendra au prochain passage.")
    print(f"Rattrapage des performances : {faits} jours.")


def instantane_cotes(jour):
    """Argent malin : on note les cotes de chaque partant a chaque passage (toutes les 15 min)."""
    p = chemin_jour(jour)
    if not os.path.exists(p):
        return
    d = lire_jour(p)
    bloc = d.get("partants") or {}
    if not bloc.get("lignes"):
        return
    cols = bloc["colonnes"]
    i_r, i_c, i_n, i_cote = cols.index("r"), cols.index("c"), cols.index("num"), cols.index("cote_finale")
    dossier = os.path.join(DOSSIER, "donnees_cotes")
    os.makedirs(dossier, exist_ok=True)
    chemin = os.path.join(dossier, f"{jour.isoformat()}.json.gz")
    histo = {}
    if os.path.exists(chemin):
        with gzip.open(chemin, "rt", encoding="utf-8") as f:
            histo = json.load(f)
    heure = dt.datetime.now(PARIS).strftime("%H:%M")
    for l in bloc["lignes"]:
        if l[i_cote]:
            serie = histo.setdefault(f"R{l[i_r]}C{l[i_c]}", {}).setdefault(str(l[i_n]), [])
            if not serie or serie[-1][1] != l[i_cote]:
                serie.append([heure, l[i_cote]])
    with gzip.open(chemin, "wt", encoding="utf-8") as f:
        json.dump(histo, f, separators=(",", ":"))


def _collecte(pmu, t0, limite, auj, args):
    # 1. Le present : avant-hier, hier, aujourd'hui et demain sont toujours mis a jour
    for k in (2, 1, 0, -1):
        jour = auj - dt.timedelta(days=k)
        if not deja_fait(jour):
            print(f"{jour} : {collecter_jour(pmu, jour, not args.monde)}", flush=True)
    instantane_cotes(auj)
    # 1 bis. Performances detaillees des partants du jour (une fois par jour suffit)
    perf = os.path.join(DOSSIER, "donnees_perf", f"{auj.isoformat()}.json.gz")
    if not os.path.exists(perf):
        print(f"Performances detaillees du {auj} : {collecter_performances(pmu, auj, garder_brut=True)} courses", flush=True)
    # 2. Le passe : on remonte jusqu'a 10 ans tant qu'il reste du temps
    debut = auj - dt.timedelta(days=int(365.25 * ANNEES))
    jour, n = auj - dt.timedelta(days=3), 0
    while jour >= debut and time.time() < limite:
        if not deja_fait(jour):
            print(f"{jour} : {collecter_jour(pmu, jour, not args.monde)}", flush=True)
            n += 1
        jour -= dt.timedelta(days=1)
    print(f"Historique : {n} jours ajoutes en {(time.time() - t0) / 60:.1f} min.")


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
    # Tous les vrais partants des courses arrivees (disqualifies compris), noms harmonises
    sql = """SELECT REPLACE(REPLACE(p.driver, '. ', '.'), '.', '. ') d, COUNT(*) n,
                    SUM(p.place_arrivee = 1),
                    ROUND(100.0 * SUM(p.place_arrivee = 1) / COUNT(*), 1),
                    ROUND(100.0 * SUM(p.place_arrivee BETWEEN 1 AND 3) / COUNT(*), 1)
             FROM partants p JOIN courses c USING (date, r, c)
             WHERE p.driver IS NOT NULL AND p.statut = 'PARTANT' AND c.arrivee IS NOT NULL
             GROUP BY d HAVING n >= 50 ORDER BY 3 DESC LIMIT 15"""
    for row in con.execute(sql):
        l.append("| " + " | ".join(str(x) for x in row) + " |")
    texte = "\n".join(l) + "\n"
    with open(os.path.join(DOSSIER, "BILAN.md"), "w", encoding="utf-8") as f:
        f.write(texte)
    print(texte)


# --------------------------------------------------------------------------
# Publication pour l'appli (docs/data/*.json, lu par docs/index.html)
# --------------------------------------------------------------------------

POINTS_MUSIQUE = {"1": 1.0, "2": 0.7, "3": 0.55, "4": 0.4, "5": 0.3}


def forme_musique(musique, n=5):
    """Note de 0 a 1 sur les n dernieres courses de la musique (ex. '4aDa5a(25)3a')."""
    if not musique:
        return None
    import re
    m = re.sub(r"\(\d+\)", "", musique)
    places = re.findall(r"([0-9DATRS])[a-zA-Z]", m)[:n]
    if not places:
        return None
    pts = [POINTS_MUSIQUE.get(x, 0.15 if x.isdigit() and x != "0" else 0.05) for x in places]
    return sum(pts) / len(pts)


def nom_propre(x):
    return (x or "").replace(". ", ".").replace(".", ". ").strip() or None


def taux(stats, cle, base=0.1, k=20):
    n, v, pl = stats.get(cle, (0, 0, 0))
    n, v, pl = n or 0, v or 0, pl or 0
    return (v + k * base) / (n + k), n, v, pl


def charger_stats(con, depuis):
    """Victoires et places par driver et par entraineur depuis une date."""
    out = {}
    for champ in ("driver", "entraineur"):
        sql = f"""SELECT REPLACE(REPLACE(p.{champ}, '. ', '.'), '.', '. '), COUNT(*),
                         SUM(p.place_arrivee = 1), SUM(p.place_arrivee BETWEEN 1 AND 3)
                  FROM partants p JOIN courses c USING (date, r, c)
                  WHERE p.statut = 'PARTANT' AND c.arrivee IS NOT NULL AND p.date >= ?
                  GROUP BY 1"""
        out[champ] = {row[0].strip(): tuple(x or 0 for x in row[1:]) for row in con.execute(sql, (depuis,)) if row[0]}
    return out


def indice_course(partants, stats):
    """Indice Yanis provisoire : marche + forme du cheval + reussite driver/entraineur."""
    vivants = [p for p in partants if p["statut"] == "PARTANT"]
    if not vivants:
        return
    base = 1 / len(vivants)
    for p in vivants:
        td, nd, vd, pd = taux(stats["driver"], nom_propre(p["driver"]), base)
        te, ne, ve, pe = taux(stats["entraineur"], nom_propre(p["entraineur"]), base)
        f = forme_musique(p["musique"])
        p["st_driver"] = [nd, vd, pd]
        p["st_entraineur"] = [ne, ve, pe]
        p["forme"] = round(f, 2) if f is not None else None
        p["_stat"] = (td / base) ** 0.5 * (te / base) ** 0.5 * (0.3 + (f if f is not None else 0.3))
    tot = sum(p["_stat"] for p in vivants)
    cotes = [p.get("cote") or p.get("cote_ref") for p in vivants]
    marche_ok = all(c and c > 1 for c in cotes)
    if marche_ok:
        inv = [1 / c for c in cotes]
        s_inv = sum(inv)
        for p, i in zip(vivants, inv):
            p["proba_marche"] = round(i / s_inv, 4)
    brut = []
    for p in vivants:
        ps = p["_stat"] / tot
        brut.append(p["proba_marche"] ** 0.75 * ps ** 0.25 if marche_ok else ps)
    s = sum(brut)
    for p, b in zip(vivants, brut):
        p["proba"] = round(b / s, 4)
        p["value"] = bool(marche_ok and p["proba"] >= 1.15 * p["proba_marche"] and (p.get("cote") or 0) >= 2.5)
        del p["_stat"]
    for rang, p in enumerate(sorted(vivants, key=lambda x: -x["proba"]), 1):
        p["rang"] = rang


def journee_pour_appli(con, date, stats):
    q = lambda sql, *a: con.execute(sql, a)
    reunions = []
    for r, hippo, pays, temp, ciel in q("SELECT r, hippodrome, pays, meteo_temperature, meteo_ciel FROM reunions WHERE date=? ORDER BY r", date):
        courses = []
        for row in q("""SELECT c, libelle, depart, discipline, specialite, distance, partants, allocation,
                               terrain, arrivee, statut, conditions, corde, categorie, paris
                        FROM courses WHERE date=? AND r=? ORDER BY c""", date, r):
            c = dict(zip(["c", "libelle", "depart", "discipline", "specialite", "distance", "nb_partants",
                          "allocation", "terrain", "arrivee", "statut", "conditions", "corde", "categorie", "paris"], row))
            c["paris"] = None if c["paris"] is None else [x for x in c["paris"].split(",") if x]
            parts = []
            for pr in q("""SELECT num, nom, statut, age, sexe, driver, entraineur, musique, deferre, oeilleres,
                                  recul_m, poids_kg, place_corde, cote_reference, cote_finale, place_arrivee,
                                  incident, gains_carriere, pere, mere
                           FROM partants WHERE date=? AND r=? AND c=? ORDER BY num""", date, r, c["c"]):
                parts.append(dict(zip(["num", "nom", "statut", "age", "sexe", "driver", "entraineur", "musique",
                                       "deferre", "oeilleres", "recul", "poids", "corde", "cote_ref", "cote",
                                       "place", "incident", "gains", "pere", "mere"], pr)))
            indice_course(parts, stats)
            c["partants"] = parts
            c["rapports"] = [dict(zip(["pari", "libelle", "combinaison", "rapport"], x)) for x in q(
                """SELECT pari, libelle, combinaison, rapport_pour_1e FROM rapports
                   WHERE date=? AND r=? AND c=? ORDER BY pari, rapport_pour_1e""", date, r, c["c"])]
            courses.append(c)
        reunions.append({"r": r, "hippodrome": hippo, "pays": pays, "temperature": temp, "ciel": ciel, "courses": courses})
    return {"date": date, "reunions": reunions}


def bilan_indice(con, stats, depuis):
    """Ce qu'aurait donne l'indice sur les courses passees (simple gagnant 1 EUR sur le n.1 de l'indice)."""
    res = {"courses": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0, "favori_gagne": 0}
    for (date,) in con.execute("SELECT DISTINCT date FROM courses WHERE date >= ? AND arrivee IS NOT NULL ORDER BY date", (depuis,)):
        j = journee_pour_appli(con, date, stats)
        for reu in j["reunions"]:
            for c in reu["courses"]:
                vivants = [p for p in c["partants"] if p.get("rang")]
                if not vivants or not c["arrivee"] or not all(p.get("cote") for p in vivants):
                    continue
                top = min(vivants, key=lambda p: p["rang"])
                fav = min(vivants, key=lambda p: p["cote"])
                res["courses"] += 1
                res["mise"] += 1
                if top.get("place") == 1:
                    res["gagnes"] += 1
                    res["retour"] += top["cote"]
                if fav.get("place") == 1:
                    res["favori_gagne"] += 1
    return res


def cmd_publier(args):
    con, jours, vides = charger_tout()
    auj = aujourdhui()
    sortie = os.path.join(DOSSIER, "docs", "data")
    os.makedirs(sortie, exist_ok=True)
    stats = charger_stats(con, (auj - dt.timedelta(days=365)).isoformat())
    maj = dt.datetime.now(PARIS).strftime("%d/%m/%Y %H:%M")

    def ecrire(nom, obj):
        with open(os.path.join(sortie, nom), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    for nom, jour in (("aujourdhui.json", auj), ("hier.json", auj - dt.timedelta(days=1)), ("demain.json", auj + dt.timedelta(days=1))):
        j = journee_pour_appli(con, jour.isoformat(), stats)
        j["maj"] = maj
        ch = os.path.join(DOSSIER, "donnees_cotes", f"{jour.isoformat()}.json.gz")
        if os.path.exists(ch):
            with gzip.open(ch, "rt", encoding="utf-8") as f:
                histo = json.load(f)
            for reu in j["reunions"]:
                for c in reu["courses"]:
                    h = histo.get(f"R{reu['r']}C{c['c']}", {})
                    for pt in c["partants"]:
                        serie = h.get(str(pt["num"]))
                        if serie:
                            pt["cotes_suivies"] = serie[-8:]
        ecrire(nom, j)

    q = lambda sql, *a: con.execute(sql, a).fetchone()[0]
    def top(champ, mini):
        lignes = sorted(((k, *v) for k, v in stats[champ].items() if v[0] >= mini), key=lambda x: -x[2])[:20]
        return [{"nom": k, "courses": n, "victoires": v, "places": pl} for k, n, v, pl in lignes]
    debut_objectif = (auj - dt.timedelta(days=int(365.25 * ANNEES))).isoformat()
    plus_ancien = q("SELECT MIN(date) FROM courses")
    total_jours = (auj - dt.date.fromisoformat(debut_objectif)).days
    fait = (auj - dt.date.fromisoformat(plus_ancien)).days if plus_ancien else 0
    ecrire("tableau.json", {
        "maj": maj,
        "bibliotheque": {
            "jours": jours, "debut": plus_ancien, "fin": q("SELECT MAX(date) FROM courses"),
            "objectif_debut": debut_objectif, "progression": round(100 * min(fait / total_jours, 1), 1),
            "reunions": q("SELECT COUNT(*) FROM reunions"), "courses": q("SELECT COUNT(*) FROM courses"),
            "partants": q("SELECT COUNT(*) FROM partants"), "rapports": q("SELECT COUNT(*) FROM rapports"),
        },
        "disciplines": [{"nom": d, "courses": n} for d, n in con.execute(
            "SELECT discipline, COUNT(*) FROM courses GROUP BY 1 ORDER BY 2 DESC") if d],
        "drivers": top("driver", 30),
        "entraineurs": top("entraineur", 20),
        "indice_30j": bilan_indice(con, stats, (auj - dt.timedelta(days=30)).isoformat()),
    })
    print(f"Appli publiee dans docs/data ({maj}).")


def main():
    ap = argparse.ArgumentParser(description="Yanis - bibliotheque hippique (etape 1)")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("test").set_defaults(f=cmd_test)
    p = sp.add_parser("collecte"); p.add_argument("--budget", type=float, default=25); p.add_argument("--monde", action="store_true"); p.set_defaults(f=cmd_collecte)
    p = sp.add_parser("jour"); p.add_argument("date"); p.add_argument("--monde", action="store_true"); p.set_defaults(f=cmd_jour)
    sp.add_parser("bilan").set_defaults(f=cmd_bilan)
    sp.add_parser("publier").set_defaults(f=cmd_publier)
    p = sp.add_parser("perfs"); p.add_argument("--budget", type=float, default=10); p.set_defaults(f=cmd_perfs)
    args = ap.parse_args()
    args.f(args)


if __name__ == "__main__":
    main()
