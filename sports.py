#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YANIS SPORTS - toutes les disciplines a deux issues, d'un coup :
NBA, NHL, NFL, MLB, tennis ATP, tennis WTA, MMA (UFC).

Meme methode chirurgicale que pour les chevaux et le foot :
1. Bibliotheque : tous les resultats jour par jour (ESPN), 2 ans en arriere, jamais effaces.
   donnees_sport/<sport>/AAAA-MM-JJ.json
2. Note de puissance Elo pour chaque equipe / joueur / combattant (avantage du terrain compris).
3. Probabilite de victoire pour chaque match a venir, cotes des bookmakers quand ESPN les donne.
4. Double filtre d'Abdel : proba > 50 % ET value (la cote paie plus que le risque reel).
5. Banc d'essai honnete : chaque match passe est predit AVANT de connaitre son resultat.

Sortie pour l'appli : docs/data/sports.json

Commande :
  python sports.py --budget 12     met a jour (12 minutes maximum de collecte d'historique)
"""

import argparse
import datetime as dt
import json
import math
import os
import time
import urllib.error
import urllib.request

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:
    PARIS = None

DOSSIER = os.path.dirname(os.path.abspath(__file__))
BIBLIO = os.path.join(DOSSIER, "donnees_sport")
SORTIE = os.path.join(DOSSIER, "docs", "data")
ESPN = "https://site.api.espn.com/apis/site/v2/sports"
ENTETES = {"User-Agent": "Mozilla/5.0 yanis-perso/1.0", "Accept": "application/json"}
JOURS_HISTO = 730
SEUIL_PROBA, SEUIL_VALUE = 0.50, 0.03

# nom, chemin ESPN, K (vitesse d'apprentissage Elo), avantage du terrain (points Elo), terrain ou pas
SPORTS = {
    "nba": ("NBA", "basketball/nba", 20, 70, True),
    "nhl": ("NHL", "hockey/nhl", 8, 35, True),
    "nfl": ("NFL", "football/nfl", 20, 48, True),
    "mlb": ("MLB", "baseball/mlb", 4, 24, True),
    "atp": ("Tennis ATP", "tennis/atp", 32, 0, False),
    "wta": ("Tennis WTA", "tennis/wta", 32, 0, False),
    "ufc": ("MMA – UFC", "mma/ufc", 40, 0, False),
}


def maintenant():
    return dt.datetime.now(PARIS) if PARIS else dt.datetime.now()


def lire_url(url):
    for essai in range(3):
        try:
            req = urllib.request.Request(url, headers=ENTETES)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
        except Exception:
            pass
        time.sleep(2 * (essai + 1))
    return None


# --------------------------------------------------------------------------
# Lecture d'un tableau de scores ESPN (tous sports)
# --------------------------------------------------------------------------

def decimal_depuis_americaine(x):
    try:
        v = float(str(x).replace("+", "").strip())
    except (TypeError, ValueError):
        return None
    if v == 0:
        return None
    return round(1 + (v / 100 if v > 0 else 100 / -v), 3)


def lire_cotes(comp):
    """Cotes victoire domicile / exterieur si ESPN les fournit (formats anciens et nouveaux)."""
    for o in comp.get("odds") or []:
        dom = (o.get("homeTeamOdds") or {}).get("moneyLine")
        ext = (o.get("awayTeamOdds") or {}).get("moneyLine")
        ml = o.get("moneyline") or {}
        if dom is None:
            dom = ((ml.get("home") or {}).get("close") or (ml.get("home") or {}).get("open") or {}).get("odds")
        if ext is None:
            ext = ((ml.get("away") or {}).get("close") or (ml.get("away") or {}).get("open") or {}).get("odds")
        d, e = decimal_depuis_americaine(dom), decimal_depuis_americaine(ext)
        if d and e:
            return {"dom": d, "ext": e, "source": o.get("provider", {}).get("name")}
    return None


def nom_participant(c):
    return ((c.get("team") or {}).get("displayName") or (c.get("athlete") or {}).get("displayName")
            or (c.get("athlete") or {}).get("fullName"))


def extraire(js):
    """Liste des rencontres d'un tableau ESPN : participants, vainqueur, statut, cotes."""
    out = []
    for ev in (js or {}).get("events", []):
        comps = ev.get("competitions") or [c for g in ev.get("groupings", []) for c in g.get("competitions", [])]
        for c in comps:
            parts = c.get("competitors") or []
            if len(parts) != 2:
                continue
            st = ((c.get("status") or ev.get("status") or {}).get("type") or {})
            home = next((p for p in parts if p.get("homeAway") == "home"), parts[0])
            away = next((p for p in parts if p is not home), parts[1])
            nd, ne = nom_participant(home), nom_participant(away)
            if not nd or not ne:
                continue
            vainqueur = None
            if st.get("completed") or st.get("state") == "post":
                if home.get("winner") is True:
                    vainqueur = "dom"
                elif away.get("winner") is True:
                    vainqueur = "ext"
                else:
                    try:
                        sd, se = float(home.get("score")), float(away.get("score"))
                        vainqueur = "dom" if sd > se else "ext" if se > sd else None
                    except (TypeError, ValueError):
                        vainqueur = None
            out.append({
                "id": str(c.get("id") or ev.get("id")), "date": c.get("date") or ev.get("date"),
                "evenement": ev.get("name") or ev.get("shortName"),
                "dom": nd, "ext": ne, "etat": st.get("state"), "fini": bool(st.get("completed")),
                "vainqueur": vainqueur, "cotes": lire_cotes(c),
            })
    return out


# --------------------------------------------------------------------------
# Bibliotheque jour par jour
# --------------------------------------------------------------------------

def chemin(sport, jour):
    return os.path.join(BIBLIO, sport, f"{jour.isoformat()}.json")


def collecter(sport, chemin_espn, jour):
    js = lire_url(f"{ESPN}/{chemin_espn}/scoreboard?dates={jour:%Y%m%d}&limit=300")
    if js is None:
        return None
    rencontres = [r for r in extraire(js) if r["date"] and r["date"][:10] <= (jour + dt.timedelta(days=1)).isoformat()]
    ancien = chemin(sport, jour)
    if os.path.exists(ancien):
        try:
            with open(ancien, encoding="utf-8") as f:
                cotes = {r["id"]: r["cotes"] for r in json.load(f)["rencontres"] if r.get("cotes")}
            for r in rencontres:
                if not r.get("cotes") and r["id"] in cotes:
                    r["cotes"] = cotes[r["id"]]  # la cote d'avant-match reste en bibliotheque
        except Exception:
            pass
    os.makedirs(os.path.join(BIBLIO, sport), exist_ok=True)
    with open(chemin(sport, jour), "w", encoding="utf-8") as f:
        json.dump({"jour": jour.isoformat(), "final": jour < maintenant().date() - dt.timedelta(days=1),
                   "rencontres": rencontres}, f, ensure_ascii=False, separators=(",", ":"))
    return len(rencontres)


def deja_fait(sport, jour):
    p = chemin(sport, jour)
    if not os.path.exists(p):
        return False
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("final", False)
    except Exception:
        return False


def mettre_a_jour(budget_min, etat):
    limite = time.time() + budget_min * 60
    auj = maintenant().date()
    # 1. le present pour tout le monde : avant-hier -> dans 7 jours (resultats + matchs a venir)
    for sport, (_, ch, *_r) in SPORTS.items():
        for k in range(-2, 8):
            jour = auj + dt.timedelta(days=k)
            if k < -1 and deja_fait(sport, jour):
                continue
            n = collecter(sport, ch, jour)
            etat.setdefault(sport, {"ok": 0, "echecs": 0})
            etat[sport]["ok" if n is not None else "echecs"] += 1
    # 2. l'historique, a tour de role entre les sports, tant qu'il reste du temps
    curseurs = {s: auj - dt.timedelta(days=3) for s in SPORTS}
    debut = auj - dt.timedelta(days=JOURS_HISTO)
    actifs = list(SPORTS)
    while actifs and time.time() < limite:
        for sport in list(actifs):
            d = curseurs[sport]
            while d >= debut and deja_fait(sport, d):
                d -= dt.timedelta(days=1)
            if d < debut:
                actifs.remove(sport)
                continue
            n = collecter(sport, SPORTS[sport][1], d)
            if n is None:
                etat[sport]["echecs"] += 1
            curseurs[sport] = d - dt.timedelta(days=1)
            if time.time() >= limite:
                break


def charger(sport):
    dossier = os.path.join(BIBLIO, sport)
    vus, tout = set(), []
    if not os.path.isdir(dossier):
        return tout
    for nom in sorted(os.listdir(dossier)):
        if not nom.endswith(".json"):
            continue
        with open(os.path.join(dossier, nom), encoding="utf-8") as f:
            for r in json.load(f)["rencontres"]:
                if r["id"] in vus:
                    continue
                vus.add(r["id"])
                tout.append(r)
    tout.sort(key=lambda r: r["date"] or "")
    return tout


# --------------------------------------------------------------------------
# Elo + banc d'essai + matchs a venir
# --------------------------------------------------------------------------

def proba_elo(ra, rb, avantage):
    return 1 / (1 + 10 ** ((rb - (ra + avantage)) / 400))


def selection(p_dom, cotes):
    """Double filtre sur les deux issues. Renvoie le pari retenu ou None."""
    if not cotes:
        return None
    for cote_cle, p in (("dom", p_dom), ("ext", 1 - p_dom)):
        value = p * cotes[cote_cle] - 1
        if p >= SEUIL_PROBA and value >= SEUIL_VALUE:
            return {"cote": cotes[cote_cle], "camp": cote_cle, "proba": round(p, 3), "value": round(value, 3)}
    return None


def analyser(sport):
    nom, _, K, avantage, terrain = SPORTS[sport]
    mini = 1 if sport == "ufc" else 5
    rencontres = charger(sport)
    elo, nb = {}, {}
    banc = {"matchs": 0, "fav_gagne": 0, "paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0, "brier": 0.0}
    a_venir = []
    auj = maintenant().date().isoformat()
    for r in rencontres:
        rd, re_ = elo.get(r["dom"], 1500), elo.get(r["ext"], 1500)
        adv = avantage if terrain else 0
        p = proba_elo(rd, re_, adv)
        if r["vainqueur"] in ("dom", "ext"):
            # banc d'essai : prediction faite avant de connaitre le resultat
            experience = min(nb.get(r["dom"], 0), nb.get(r["ext"], 0))
            if experience >= mini:
                reel = 1.0 if r["vainqueur"] == "dom" else 0.0
                banc["matchs"] += 1
                banc["fav_gagne"] += int((p >= 0.5) == (reel == 1.0))
                banc["brier"] += (p - reel) ** 2
                s = selection(p, r.get("cotes"))
                if s:
                    gagne = (s["camp"] == r["vainqueur"])
                    banc["paris"] += 1; banc["gagnes"] += int(gagne); banc["mise"] += 1
                    banc["retour"] += s["cote"] if gagne else 0
            # mise a jour Elo (apprentissage plus rapide pour les nouveaux venus)
            reel = 1.0 if r["vainqueur"] == "dom" else 0.0
            kd = K * (1.5 if nb.get(r["dom"], 0) < 10 else 1)
            ke = K * (1.5 if nb.get(r["ext"], 0) < 10 else 1)
            elo[r["dom"]] = rd + kd * (reel - p)
            elo[r["ext"]] = re_ - ke * (reel - p)
            nb[r["dom"]] = nb.get(r["dom"], 0) + 1
            nb[r["ext"]] = nb.get(r["ext"], 0) + 1
        elif r["etat"] in ("pre", "in") and (r["date"] or "")[:10] >= auj:
            fiable = min(nb.get(r["dom"], 0), nb.get(r["ext"], 0)) >= mini
            heure = None
            try:
                t = dt.datetime.fromisoformat(r["date"].replace("Z", "+00:00"))
                heure = t.astimezone(PARIS).strftime("%Y-%m-%d %H:%M") if PARIS else r["date"]
            except Exception:
                pass
            a_venir.append({
                "quand": heure, "evenement": r.get("evenement") if not terrain else None,
                "dom": r["dom"], "ext": r["ext"], "p_dom": round(p, 3), "fiable": fiable,
                "elo_dom": round(rd), "elo_ext": round(re_), "cotes": r.get("cotes"),
                "selection": selection(p, r.get("cotes")) if fiable else None, "en_cours": r["etat"] == "in",
            })
    m = banc["matchs"]
    banc_sortie = {
        "matchs": m, "reussite_favori": round(banc["fav_gagne"] / m, 3) if m else None,
        "brier": round(banc["brier"] / m, 3) if m else None,
        "paris": banc["paris"], "reussite_paris": round(banc["gagnes"] / banc["paris"], 3) if banc["paris"] else None,
        "roi": round((banc["retour"] - banc["mise"]) / banc["mise"], 4) if banc["mise"] else None,
    }
    top = sorted(((k, v) for k, v in elo.items() if nb.get(k, 0) >= 10), key=lambda x: -x[1])[:15]
    dates = [r["date"][:10] for r in rencontres if r.get("date") and r["vainqueur"]]
    return {
        "nom": nom, "terrain": terrain,
        "bibliotheque": {"rencontres": len([r for r in rencontres if r["vainqueur"]]),
                         "debut": min(dates) if dates else None, "fin": max(dates) if dates else None},
        "banc_essai": banc_sortie,
        "a_venir": sorted(a_venir, key=lambda x: x["quand"] or "")[:150],
        "classement": [{"nom": k, "elo": round(v)} for k, v in top],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=12)
    args = ap.parse_args()
    t0 = time.time()
    etat = {}
    mettre_a_jour(args.budget, etat)
    resultat = {"maj": maintenant().strftime("%d/%m/%Y %H:%M"), "filtre": {"proba": SEUIL_PROBA, "value": SEUIL_VALUE},
                "sports": {}, "etat_sources": etat}
    for sport in SPORTS:
        try:
            resultat["sports"][sport] = analyser(sport)
            b = resultat["sports"][sport]
            print(f"{b['nom']}: {b['bibliotheque']['rencontres']} resultats, {len(b['a_venir'])} a venir, "
                  f"favori gagnant {b['banc_essai']['reussite_favori']}, paris {b['banc_essai']['paris']}, roi {b['banc_essai']['roi']}")
        except Exception as e:
            print(f"{sport}: erreur {e}")
    os.makedirs(SORTIE, exist_ok=True)
    with open(os.path.join(SORTIE, "sports.json"), "w", encoding="utf-8") as f:
        json.dump(resultat, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Termine en {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
