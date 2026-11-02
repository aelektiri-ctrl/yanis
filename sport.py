#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YANIS SPORT - Football (premiere discipline du volet sportif).

1. Bibliotheque : resultats + cotes des bookmakers (football-data.co.uk), 10 saisons,
   18 championnats europeens, ranges dans donnees_sport/football/.
2. Modele : force d'attaque et de defense de chaque equipe (loi de Poisson, matchs
   recents plus importants, avantage du terrain), recalcule a chaque passage.
3. Double filtre d'Abdel : probabilite > 50 % ET cote qui paie plus que le risque (value).
4. Banc d'essai honnete : le modele est rejoue sur la saison passee sans jamais voir
   l'avenir, et compare aux cotes de cloture des bookmakers.

Sortie pour l'appli : docs/data/foot.json

Commandes :
  python sport.py            met a jour la bibliotheque, le modele et l'appli
  python sport.py --complet  retelecharge aussi toutes les anciennes saisons
"""

import csv
import datetime as dt
import io
import json
import re
import unicodedata
import math
import os
import sys
import time
import urllib.request

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson

try:
    from zoneinfo import ZoneInfo
    PARIS, LONDRES = ZoneInfo("Europe/Paris"), ZoneInfo("Europe/London")
except Exception:
    PARIS = LONDRES = None

DOSSIER = os.path.dirname(os.path.abspath(__file__))
BIBLIO = os.path.join(DOSSIER, "donnees_sport", "football")
SORTIE = os.path.join(DOSSIER, "docs", "data")
SOURCE = "https://www.football-data.co.uk"
ENTETES = {"User-Agent": "Mozilla/5.0 yanis-perso/1.0"}

LIGUES = {
    "F1": "Ligue 1", "F2": "Ligue 2",
    "E0": "Premier League", "E1": "Championship", "E2": "League One", "E3": "League Two",
    "SP1": "Liga", "SP2": "Liga 2", "I1": "Serie A", "I2": "Serie B",
    "D1": "Bundesliga", "D2": "2. Bundesliga", "N1": "Eredivisie", "B1": "Jupiler Pro League",
    "P1": "Liga Portugal", "T1": "Super Lig", "G1": "Super League Grece", "SC0": "Premiership Ecosse",
}
# Correspondance vers les codes ESPN (source rapide de resultats, additive).
ESPN_LIGUES = {
    "F1": "fra.1", "F2": "fra.2", "E0": "eng.1", "E1": "eng.2", "E2": "eng.3", "E3": "eng.4",
    "SP1": "esp.1", "SP2": "esp.2", "I1": "ita.1", "I2": "ita.2", "D1": "ger.1", "D2": "ger.2",
    "N1": "ned.1", "B1": "bel.1", "P1": "por.1", "T1": "tur.1", "G1": "gre.1", "SC0": "sco.1",
}
NOM_VERS_ESPN = {LIGUES[c]: s for c, s in ESPN_LIGUES.items()}
NB_SAISONS = 10
DEMI_VIE_JOURS = 365          # un match d'il y a un an compte moitie moins qu'un match d'hier
SEUIL_PROBA = 0.50            # filtre 1 : plus d'une chance sur deux
SEUIL_VALUE = 0.03            # filtre 2 : la cote paie au moins 3 % de plus que le risque reel

# Journal du parieur virtuel : Yanis joue pour de faux, mais honnetement.
# Chaque jour il repart avec 100 EUR. Il est SELECTIF : il ne mise que sur ses
# meilleurs coups du jour (2 au maximum), et quand rien ne vaut le coup, il ne
# joue pas du tout. Le soir, on solde avec les vrais resultats. Pas de triche :
# sur la duree, ce compteur va probablement baisser, et c'est justement la preuve
# qui se joue sous les yeux d'Abdel.
CREDIT_JOUR = 100.0           # credit remis a zero chaque jour
MISE_PARI = 10.0             # mise fixe par pari (un seul jour ne peut pas tout faire exploser)
MAX_PARIS_JOUR = 2            # joueur methodique : deux coups par jour au maximum
SEUIL_VALUE_JOURNAL = 0.05    # selectif : on ne retient que la vraie valeur, pas le tout-venant
MARCHE_LABEL = {"1": "Victoire domicile", "N": "Match nul", "2": "Victoire exterieur",
                "+2.5": "Plus de 2,5 buts", "-2.5": "Moins de 2,5 buts"}


# --------------------------------------------------------------------------
# Bibliotheque
# --------------------------------------------------------------------------

def maintenant():
    return dt.datetime.now(PARIS) if PARIS else dt.datetime.now()


def code_saison(d):
    a = d.year if d.month >= 7 else d.year - 1
    return f"{a % 100:02d}{(a + 1) % 100:02d}"


def saisons(n):
    d = maintenant().date()
    out = []
    for k in range(n):
        out.append(code_saison(dt.date(d.year - k, d.month, 1)))
    return out


def telecharger(url):
    for essai in range(3):
        try:
            req = urllib.request.Request(url, headers=ENTETES)
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("latin-1")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(3 * (essai + 1))
    return None


def mettre_a_jour_bibliotheque(complet, etat):
    os.makedirs(BIBLIO, exist_ok=True)
    liste = saisons(NB_SAISONS)
    for i, s in enumerate(liste):
        for lg in LIGUES:
            chemin = os.path.join(BIBLIO, f"{s}_{lg}.csv")
            if i >= 2 and os.path.exists(chemin) and not complet:
                continue  # saison terminee deja en bibliotheque
            txt = telecharger(f"{SOURCE}/mmz4281/{s}/{lg}.csv")
            if txt and "HomeTeam" in txt[:400]:
                txt = txt.lstrip("\ufeff").removeprefix("\u00ef\u00bb\u00bf")
                with open(chemin, "w", encoding="utf-8") as f:
                    f.write(txt)
                etat["fichiers_ok"] += 1
            else:
                etat["fichiers_absents"].append(f"{s}_{lg}")
    txt = telecharger(f"{SOURCE}/fixtures.csv")
    if txt and "HomeTeam" in txt[:400]:
        txt = txt.lstrip("\ufeff").removeprefix("\u00ef\u00bb\u00bf")
        with open(os.path.join(BIBLIO, "a_venir.csv"), "w", encoding="utf-8") as f:
            f.write(txt)
        etat["a_venir"] = "ok"
    else:
        etat["a_venir"] = "indisponible"


def nombre(x):
    try:
        v = float(x)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def buts(x):
    """Nombre de buts : 0 est une vraie valeur (contrairement a une cote)."""
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def date_match(txt):
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return dt.datetime.strptime(txt.strip(), fmt).date()
        except (ValueError, AttributeError):
            pass
    return None


def premiere(ligne, *noms):
    for n in noms:
        v = nombre(ligne.get(n))
        if v:
            return v
    return None


def lire_csv(chemin):
    with open(chemin, encoding="utf-8") as f:
        txt = f.read().lstrip("\ufeff").removeprefix("\u00ef\u00bb\u00bf")  # BOM, meme lu en latin-1
    matchs = []
    for l in csv.DictReader(io.StringIO(txt)):
        d = date_match(l.get("Date", ""))
        if not d or not l.get("HomeTeam") or not l.get("AwayTeam"):
            continue
        m = {
            "ligue": l.get("Div", "").strip(), "date": d, "heure": (l.get("Time") or "").strip(),
            "dom": l["HomeTeam"].strip(), "ext": l["AwayTeam"].strip(),
            "bd": buts(l.get("FTHG")), "be": buts(l.get("FTAG")),
            # cotes moyennes et meilleures cotes (avant-match), puis cloture
            "c1": premiere(l, "AvgH", "BbAvH", "B365H"), "cN": premiere(l, "AvgD", "BbAvD", "B365D"), "c2": premiere(l, "AvgA", "BbAvA", "B365A"),
            "m1": premiere(l, "MaxH", "BbMxH"), "mN": premiere(l, "MaxD", "BbMxD"), "m2": premiere(l, "MaxA", "BbMxA"),
            "cP": premiere(l, "Avg>2.5", "BbAv>2.5", "B365>2.5"), "cM": premiere(l, "Avg<2.5", "BbAv<2.5", "B365<2.5"),
            "mP": premiere(l, "Max>2.5", "BbMx>2.5"), "mM": premiere(l, "Max<2.5", "BbMx<2.5"),
            "k1": premiere(l, "AvgCH", "B365CH", "AvgH"), "kN": premiere(l, "AvgCD", "B365CD", "AvgD"), "k2": premiere(l, "AvgCA", "B365CA", "AvgA"),
            "kP": premiere(l, "AvgC>2.5", "B365C>2.5", "Avg>2.5"), "kM": premiere(l, "AvgC<2.5", "B365C<2.5", "Avg<2.5"),
        }
        matchs.append(m)
    return matchs


def charger_bibliotheque():
    par_ligue = {}
    for nom in sorted(os.listdir(BIBLIO)) if os.path.isdir(BIBLIO) else []:
        if not nom.endswith(".csv") or nom == "a_venir.csv":
            continue
        lg = nom.split("_", 1)[1][:-4]
        for m in lire_csv(os.path.join(BIBLIO, nom)):
            if m["bd"] is not None and m["be"] is not None:
                m["ligue"] = lg
                par_ligue.setdefault(lg, []).append(m)
    for lg in par_ligue:
        par_ligue[lg].sort(key=lambda m: m["date"])
    return par_ligue


# --------------------------------------------------------------------------
# Modele : attaque / defense par equipe (Poisson pondere dans le temps)
# --------------------------------------------------------------------------

class Modele:
    def __init__(self, matchs, jusqua):
        recents = [m for m in matchs if m["date"] < jusqua and (jusqua - m["date"]).days <= 3 * 365]
        self.equipes = sorted({m["dom"] for m in recents} | {m["ext"] for m in recents})
        self.idx = {e: i for i, e in enumerate(self.equipes)}
        # nombre de matchs recents qui nourrissent l'estimation de chaque equipe (signal de fiabilite)
        self.n = {}
        for m in recents:
            self.n[m["dom"]] = self.n.get(m["dom"], 0) + 1
            self.n[m["ext"]] = self.n.get(m["ext"], 0) + 1
        self.ok = len(recents) >= 80
        if not self.ok:
            return
        n = len(self.equipes)
        h = np.array([self.idx[m["dom"]] for m in recents])
        a = np.array([self.idx[m["ext"]] for m in recents])
        yh = np.array([m["bd"] for m in recents], float)
        ya = np.array([m["be"] for m in recents], float)
        age = np.array([(jusqua - m["date"]).days for m in recents], float)
        w = 0.5 ** (age / DEMI_VIE_JOURS)
        ridge = 2.0

        def f(theta):
            mu, home = theta[0], theta[1]
            att, dfn = theta[2:2 + n], theta[2 + n:]
            eh = mu + home + att[h] - dfn[a]
            ea = mu + att[a] - dfn[h]
            lh, la = np.exp(eh), np.exp(ea)
            ll = np.sum(w * (yh * eh - lh)) + np.sum(w * (ya * ea - la))
            rh, ra = w * (yh - lh), w * (ya - la)
            g = np.zeros_like(theta)
            g[0] = rh.sum() + ra.sum()
            g[1] = rh.sum()
            ga = np.bincount(h, rh, n) + np.bincount(a, ra, n)
            gd = -np.bincount(a, rh, n) - np.bincount(h, ra, n)
            g[2:2 + n] = ga - ridge * att
            g[2 + n:] = gd - ridge * dfn
            ll -= 0.5 * ridge * (att @ att + dfn @ dfn)
            return -ll, -g

        x0 = np.zeros(2 + 2 * n)
        x0[0] = math.log(max(np.average(np.r_[yh, ya], weights=np.r_[w, w]), 0.3))
        res = minimize(f, x0, jac=True, method="L-BFGS-B")
        self.mu, self.home = res.x[0], res.x[1]
        self.att, self.dfn = res.x[2:2 + n], res.x[2 + n:]

    def connait(self, dom, ext):
        return self.ok and dom in self.idx and ext in self.idx

    def fiabilite(self, dom, ext):
        """Combien de matchs recents soutiennent cette prediction. Moins il y en a, moins on est sur."""
        n = min(self.n.get(dom, 0), self.n.get(ext, 0))
        niveau = "solide" if n >= 30 else "moyenne" if n >= 12 else "faible"
        return {"niveau": niveau, "matchs": n}

    def probas(self, dom, ext):
        i, j = self.idx[dom], self.idx[ext]
        lh = math.exp(self.mu + self.home + self.att[i] - self.dfn[j])
        la = math.exp(self.mu + self.att[j] - self.dfn[i])
        g = np.arange(11)
        mat = np.outer(poisson.pmf(g, lh), poisson.pmf(g, la))
        mat /= mat.sum()
        p1, pN, p2 = np.tril(mat, -1).sum(), np.trace(mat), np.triu(mat, 1).sum()
        tot = g[:, None] + g[None, :]
        plus = mat[tot >= 3].sum()
        btts = mat[1:, 1:].sum()
        k = np.unravel_index(np.argmax(mat), mat.shape)
        return {
            "1": p1, "N": pN, "2": p2, "1N": p1 + pN, "N2": pN + p2, "12": p1 + p2,
            "+2.5": plus, "-2.5": 1 - plus, "BTTS oui": btts, "BTTS non": 1 - btts,
            "buts_dom": lh, "buts_ext": la, "score": f"{k[0]}-{k[1]}",
        }


MARCHES_COTES = {"1": ("c1", "m1", "k1"), "N": ("cN", "mN", "kN"), "2": ("c2", "m2", "k2"),
                 "+2.5": ("cP", "mP", "kP"), "-2.5": ("cM", "mM", "kM")}


def selections(m, p):
    """Le double filtre : proba > 50 % et value positive sur la cote moyenne du marche."""
    out = []
    for marche, (cm, cx, _) in MARCHES_COTES.items():
        cote = m.get(cm)
        if not cote:
            continue
        value = p[marche] * cote - 1
        if p[marche] >= SEUIL_PROBA and value >= SEUIL_VALUE:
            out.append({"marche": marche, "proba": round(p[marche], 3), "cote": cote,
                        "meilleure_cote": m.get(cx), "value": round(value, 3)})
    return out


# --------------------------------------------------------------------------
# Banc d'essai honnete (le modele ne voit jamais l'avenir)
# --------------------------------------------------------------------------

def banc_essai(par_ligue, debut, pas_jours=14):
    """Rejoue le modele depuis 'debut' : on recalcule tous les 14 jours avec le passe seulement,
    on applique le double filtre, et on joue 1 EUR a la cote de cloture du marche."""
    fin = maintenant().date()
    res = {"paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0, "par_marche": {}, "par_ligue": {},
           "calibration": [[0, 0.0, 0] for _ in range(10)], "debut": debut.isoformat()}
    for lg, matchs in par_ligue.items():
        d = debut
        while d < fin:
            bloc = [m for m in matchs if d <= m["date"] < d + dt.timedelta(days=pas_jours)]
            if bloc:
                mod = Modele(matchs, d)
                for m in bloc:
                    if not mod.connait(m["dom"], m["ext"]):
                        continue
                    p = mod.probas(m["dom"], m["ext"])
                    reel = "1" if m["bd"] > m["be"] else "N" if m["bd"] == m["be"] else "2"
                    # calibration sur le 1N2 : la proba annoncee correspond-elle a la realite ?
                    for issue in ("1", "N", "2"):
                        b = min(int(p[issue] * 10), 9)
                        res["calibration"][b][0] += 1
                        res["calibration"][b][1] += p[issue]
                        res["calibration"][b][2] += int(reel == issue)
                    for s in selections(m, p):
                        marche = s["marche"]
                        cote_cloture = m.get(MARCHES_COTES[marche][2]) or s["cote"]
                        gagne = (marche == reel) or (marche == "+2.5" and m["bd"] + m["be"] >= 3) or \
                                (marche == "-2.5" and m["bd"] + m["be"] <= 2)
                        for cle, sous in (("par_marche", marche), ("par_ligue", LIGUES.get(lg, lg))):
                            x = res[cle].setdefault(sous, {"paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0})
                            x["paris"] += 1; x["gagnes"] += int(gagne); x["mise"] += 1
                            x["retour"] += cote_cloture if gagne else 0
                        res["paris"] += 1; res["gagnes"] += int(gagne); res["mise"] += 1
                        res["retour"] += cote_cloture if gagne else 0
            d += dt.timedelta(days=pas_jours)
    res["calibration"] = [{"tranche": f"{10*i}-{10*i+10} %", "matchs": n,
                           "annonce": round(s / n, 3) if n else None, "reel": round(r / n, 3) if n else None}
                          for i, (n, s, r) in enumerate(res["calibration"])]
    res["roi"] = round((res["retour"] - res["mise"]) / res["mise"], 4) if res["mise"] else None
    res["reussite"] = round(res["gagnes"] / res["paris"], 4) if res["paris"] else None
    return res


# --------------------------------------------------------------------------
# Bilan recent : les pronos deja joues, leur vrai resultat, et ce que ca aurait rapporte
# --------------------------------------------------------------------------

def bilan_recent(par_ligue, jours=28, jours_affiches=10):
    """Pour chaque match des 'jours' derniers jours ou Yanis avait une selection :
    on compare le prono au vrai resultat, et on calcule ce qu'un euro par pari aurait
    rapporte (cote de cloture si gagne). Le modele est celui du matin du match, il ne
    voit jamais le resultat. Sert a dire la verite : est-ce que ca rapporte, oui ou non."""
    fin = maintenant().date()
    debut = fin - dt.timedelta(days=jours)
    limite_aff = fin - dt.timedelta(days=jours_affiches)
    par_jour, recents = {}, []
    for lg, matchs in par_ligue.items():
        fenetre = [m for m in matchs if debut <= m["date"] < fin and m["bd"] is not None and m["be"] is not None]
        if not fenetre:
            continue
        mods = {}
        for m in sorted(fenetre, key=lambda x: x["date"]):
            d = m["date"]
            if d not in mods:
                mods[d] = Modele(matchs, d)
            mod = mods[d]
            if not mod.connait(m["dom"], m["ext"]):
                continue
            p = mod.probas(m["dom"], m["ext"])
            sels = selections(m, p)
            if not sels:
                continue
            reel = "1" if m["bd"] > m["be"] else "N" if m["bd"] == m["be"] else "2"
            jour = par_jour.setdefault(d.isoformat(), {"mise": 0.0, "retour": 0.0})
            sorties = []
            for s in sels:
                marche = s["marche"]
                cote = m.get(MARCHES_COTES[marche][2]) or s["cote"]
                gagne = (marche == reel) or (marche == "+2.5" and m["bd"] + m["be"] >= 3) or \
                        (marche == "-2.5" and m["bd"] + m["be"] <= 2)
                jour["mise"] += 1
                jour["retour"] += cote if gagne else 0
                sorties.append({"marche": marche, "cote": round(cote, 2), "gagne": gagne,
                                "retour": round(cote if gagne else 0, 2)})
            if d >= limite_aff:
                fav = max(("1", "N", "2"), key=lambda k: p[k])
                recents.append({"date": d.isoformat(), "ligue": LIGUES.get(lg, lg),
                                "dom": m["dom"], "ext": m["ext"],
                                "score_reel": f'{m["bd"]}-{m["be"]}', "score_prevu": p["score"],
                                "favori": fav, "favori_ok": fav == reel, "selections": sorties})
    jours_tries = sorted(par_jour.items())
    cumul, par_jour_liste = 0.0, []
    for d, v in jours_tries:
        net = v["retour"] - v["mise"]
        cumul += net
        par_jour_liste.append({"date": d, "mise": round(v["mise"], 2), "retour": round(v["retour"], 2),
                               "net": round(net, 2), "cumul": round(cumul, 2)})
    tm = sum(v["mise"] for _, v in jours_tries)
    tr = sum(v["retour"] for _, v in jours_tries)
    recents.sort(key=lambda x: (x["date"], x["ligue"]), reverse=True)
    return {"recents": recents[:80],
            "gains": {"par_jour": par_jour_liste, "total_mise": round(tm, 2), "total_retour": round(tr, 2),
                      "total_net": round(tr - tm, 2), "roi": round((tr - tm) / tm, 4) if tm else None,
                      "jours": jours}}


# --------------------------------------------------------------------------
# Matchs a venir
# --------------------------------------------------------------------------

def heure_paris(d, h):
    if not h:
        return None
    try:
        hh, mm = map(int, h.split(":")[:2])
        t = dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=LONDRES)
        return t.astimezone(PARIS).strftime("%H:%M") if PARIS else h
    except Exception:
        return h


def matchs_a_venir(par_ligue):
    chemin = os.path.join(BIBLIO, "a_venir.csv")
    if not os.path.exists(chemin):
        return []
    auj = maintenant().date()
    modeles, out = {}, []
    for m in lire_csv(chemin):
        lg = m["ligue"]
        if lg not in LIGUES or m["date"] < auj:
            continue
        if lg not in modeles:
            modeles[lg] = Modele(par_ligue.get(lg, []), auj)
        mod = modeles[lg]
        if not mod.connait(m["dom"], m["ext"]):
            continue
        p = mod.probas(m["dom"], m["ext"])
        sel = selections(m, p)
        out.append({
            "date": m["date"].isoformat(), "heure": heure_paris(m["date"], m["heure"]),
            "ligue": LIGUES[lg], "dom": m["dom"], "ext": m["ext"],
            "probas": {k: round(float(v), 3) for k, v in p.items() if k not in ("score",)},
            "score": p["score"],
            "cotes": {k: {"moy": m.get(c), "max": m.get(x)} for k, (c, x, _) in MARCHES_COTES.items() if m.get(c)},
            "fiabilite": mod.fiabilite(m["dom"], m["ext"]),
            "selections": sel,
        })
    out.sort(key=lambda x: (x["date"], x["heure"] or "", x["ligue"]))
    return out


def classement_forces(par_ligue):
    """Les equipes les plus fortes du moment, par championnat (attaque - defense)."""
    auj = maintenant().date()
    out = {}
    for lg in ("F1", "E0", "SP1", "I1", "D1"):
        mod = Modele(par_ligue.get(lg, []), auj)
        if not mod.ok:
            continue
        saison = code_saison(auj)
        actuelles = {m["dom"] for m in par_ligue[lg] if code_saison(m["date"]) == saison}
        lignes = [(e, mod.att[i], mod.dfn[i]) for e, i in mod.idx.items() if e in actuelles]
        lignes.sort(key=lambda x: -(x[1] + x[2]))
        out[LIGUES[lg]] = [{"equipe": e, "attaque": round(math.exp(a), 2), "defense": round(math.exp(-d), 2)}
                           for e, a, d in lignes[:8]]
    return out


# --------------------------------------------------------------------------
# Resultats rapides via ESPN (source additive : ne remplace jamais la bibliotheque,
# sert a afficher le vrai score le jour meme et a solder le journal sans attendre).
# --------------------------------------------------------------------------

_ESPN_STOP = {"fc", "sc", "ac", "cf", "afc", "cd", "ud", "sd", "ss", "as", "if", "sk",
              "bk", "club", "calcio", "futbol", "football", "de", "la", "le", "the",
              "1899", "1900", "1904", "1909", "04", "05"}


def _norm_equipe(nom):
    s = unicodedata.normalize("NFKD", nom or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return [t for t in s.split() if t and t not in _ESPN_STOP]


def _equipes_proches(a, b):
    if not a or not b:
        return False
    communs = set(a) & set(b)
    if communs and max(len(t) for t in communs) >= 4:
        return True
    ja, jb = "".join(a), "".join(b)
    return bool(ja) and bool(jb) and (ja in jb or jb in ja)


def telecharger_json(url):
    for essai in range(2):
        try:
            req = urllib.request.Request(url, headers=ENTETES)
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(2 * (essai + 1))
    return None


def resultats_espn(besoins):
    """Scores finaux via l'API publique ESPN. besoins = iterable de (slug, 'YYYYMMDD').
    Retour : {date_iso: [(toks_dom, toks_ext, buts_dom, buts_ext), ...]}. En cas d'echec : {}."""
    idx = {}
    for slug, jour in sorted(set(besoins)):
        data = telecharger_json(
            f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates={jour}")
        if not data:
            continue
        for ev in data.get("events", []):
            try:
                comp = ev["competitions"][0]
                st = (comp.get("status") or ev.get("status") or {}).get("type") or {}
                if not st.get("completed"):
                    continue
                dom = ext = hg = ag = None
                for c in comp["competitors"]:
                    equipe = c.get("team") or {}
                    nom = equipe.get("displayName") or equipe.get("name") or ""
                    sc = c.get("score")
                    sc = int(sc) if sc not in (None, "") else None
                    if c.get("homeAway") == "home":
                        dom, hg = nom, sc
                    else:
                        ext, ag = nom, sc
                if None in (dom, ext, hg, ag):
                    continue
                date_iso = f"{jour[:4]}-{jour[4:6]}-{jour[6:]}"
                idx.setdefault(date_iso, []).append((_norm_equipe(dom), _norm_equipe(ext), hg, ag))
            except Exception:
                continue
    return idx


def espn_chercher(idx, date_iso, dom, ext):
    td, te = _norm_equipe(dom), _norm_equipe(ext)
    for hd, ht, hg, ag in idx.get(date_iso, []):
        if _equipes_proches(td, hd) and _equipes_proches(te, ht):
            return hg, ag
    return None


def _besoins_espn_et_resultats(a_venir, auj):
    """Les scores a aller chercher : matchs du jour + paris en attente recents. Puis on les recupere."""
    besoins = set()
    ajd = auj.strftime("%Y%m%d")
    for m in a_venir:
        if m["date"] == auj.isoformat():
            slug = NOM_VERS_ESPN.get(m["ligue"])
            if slug:
                besoins.add((slug, ajd))
    try:
        with open(JOURNAL, encoding="utf-8") as f:
            J = json.load(f)
        for info in J.get("jours", {}).values():
            for p in info.get("paris", []):
                if p.get("statut") != "en_attente":
                    continue
                slug = NOM_VERS_ESPN.get(p.get("ligue"))
                try:
                    d = dt.date.fromisoformat(p["date_match"])
                except Exception:
                    d = None
                if slug and d and 0 <= (auj - d).days <= 7:
                    besoins.add((slug, d.strftime("%Y%m%d")))
    except Exception:
        pass
    return resultats_espn(besoins) if besoins else {}


# --------------------------------------------------------------------------
# Journal du parieur virtuel : 100 EUR par jour, selectif, solde sur les vrais resultats
# --------------------------------------------------------------------------

JOURNAL = os.path.join(SORTIE, "journal.json")


def resultat_marche(m, marche):
    """Le pari est-il gagne, au vu du vrai score ? Meme logique que le banc d'essai."""
    reel = "1" if m["bd"] > m["be"] else "N" if m["bd"] == m["be"] else "2"
    if marche in ("1", "N", "2"):
        return marche == reel
    if marche == "+2.5":
        return m["bd"] + m["be"] >= 3
    if marche == "-2.5":
        return m["bd"] + m["be"] <= 2
    return False


def _recap_jour(info):
    """Recalcule le bilan d'un jour a partir de ses paris (seuls les paris soldes comptent)."""
    soldes = [p for p in info["paris"] if p["statut"] in ("gagne", "perdu")]
    mise = sum(p["mise"] for p in soldes)
    retour = sum(p["retour"] for p in soldes)
    en_attente = sum(1 for p in info["paris"] if p["statut"] == "en_attente")
    info["mise_totale"] = round(mise, 2)
    info["retour_total"] = round(retour, 2)
    info["net"] = round(retour - mise, 2)
    info["capital_fin"] = round(info["capital_depart"] + retour - mise, 2)
    info["en_attente"] = en_attente
    info["statut"] = "en_cours" if en_attente else "clos"


def _resume_global(jours):
    tj = sorted(jours.items())
    tm = tr = cumul = 0.0
    nj = ns = paris = gagnes = 0
    courbe = []
    for d, info in tj:
        tm += info.get("mise_totale", 0.0)
        tr += info.get("retour_total", 0.0)
        for p in info["paris"]:
            if p["statut"] in ("gagne", "perdu"):
                paris += 1
                gagnes += int(p["statut"] == "gagne")
        if info.get("sans_pari"):
            ns += 1
        elif any(p["statut"] in ("gagne", "perdu") for p in info["paris"]):
            nj += 1
        cumul += info.get("net", 0.0)
        courbe.append({"date": d, "net": round(info.get("net", 0.0), 2),
                       "cumul": round(cumul, 2), "statut": info.get("statut")})
    return {"jours_joues": nj, "jours_sans_pari": ns, "paris": paris, "gagnes": gagnes,
            "reussite": round(gagnes / paris, 3) if paris else None,
            "total_mise": round(tm, 2), "total_retour": round(tr, 2), "total_net": round(tr - tm, 2),
            "roi": round((tr - tm) / tm, 4) if tm else None,
            "capital_cumule": round(CREDIT_JOUR + cumul, 2), "courbe": courbe}


def _par_formule(jours):
    agg = {}
    for _, info in jours.items():
        for p in info["paris"]:
            if p["statut"] not in ("gagne", "perdu"):
                continue
            x = agg.setdefault(p["marche"], {"paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0})
            x["paris"] += 1
            x["gagnes"] += int(p["statut"] == "gagne")
            x["mise"] += p["mise"]
            x["retour"] += p["retour"]
    out = []
    for marche, x in agg.items():
        out.append({"marche": marche, "nom": MARCHE_LABEL.get(marche, marche),
                    "paris": x["paris"], "gagnes": x["gagnes"],
                    "reussite": round(x["gagnes"] / x["paris"], 3) if x["paris"] else None,
                    "net": round(x["retour"] - x["mise"], 2),
                    "roi": round((x["retour"] - x["mise"]) / x["mise"], 4) if x["mise"] else None})
    out.sort(key=lambda r: r["net"], reverse=True)
    return out


def _bilans_semaine(jours):
    sem = {}
    for d, info in jours.items():
        try:
            y, w, _ = dt.date.fromisoformat(d).isocalendar()
        except Exception:
            continue
        s = sem.setdefault((y, w), {"mise": 0.0, "retour": 0.0, "net": 0.0, "paris": 0, "gagnes": 0, "jours": 0})
        s["mise"] += info.get("mise_totale", 0.0)
        s["retour"] += info.get("retour_total", 0.0)
        s["net"] += info.get("net", 0.0)
        s["jours"] += 1
        for p in info["paris"]:
            if p["statut"] in ("gagne", "perdu"):
                s["paris"] += 1
                s["gagnes"] += int(p["statut"] == "gagne")
    out = []
    for (y, w), s in sorted(sem.items(), reverse=True):
        lundi = dt.date.fromisocalendar(y, w, 1)
        out.append({"semaine": f"Semaine du {lundi.strftime('%d/%m')}", "lundi": lundi.isoformat(),
                    "mise": round(s["mise"], 2), "retour": round(s["retour"], 2), "net": round(s["net"], 2),
                    "paris": s["paris"], "gagnes": s["gagnes"],
                    "roi": round(s["net"] / s["mise"], 4) if s["mise"] else None})
    return out


def journal_virtuel(par_ligue, a_venir, espn_idx=None):
    """Fait vivre le parieur virtuel : solde les paris en attente avec les vrais
    resultats, puis place (une seule fois) les coups selectifs du jour."""
    auj = maintenant().date()
    try:
        with open(JOURNAL, encoding="utf-8") as f:
            J = json.load(f)
    except Exception:
        J = {"regles": {"credit_jour": CREDIT_JOUR, "mise_pari": MISE_PARI,
                        "max_paris": MAX_PARIS_JOUR, "seuil_value": SEUIL_VALUE_JOURNAL}, "jours": {}}
    jours = J.setdefault("jours", {})

    # index des resultats connus pour solder
    res_idx = {}
    for lg, matchs in par_ligue.items():
        for m in matchs:
            if m["bd"] is not None and m["be"] is not None:
                res_idx[(m["date"].isoformat(), m["dom"], m["ext"])] = m

    # 1. solder les paris en attente
    for djour, info in jours.items():
        for pari in info["paris"]:
            if pari["statut"] != "en_attente":
                continue
            m = res_idx.get((pari["date_match"], pari["dom"], pari["ext"]))
            if m:
                gagne = resultat_marche(m, pari["marche"])
                pari["statut"] = "gagne" if gagne else "perdu"
                pari["score_reel"] = f'{m["bd"]}-{m["be"]}'
                pari["retour"] = round(pari["mise"] * pari["cote"], 2) if gagne else 0.0
            else:
                r = espn_chercher(espn_idx or {}, pari["date_match"], pari["dom"], pari["ext"])
                if r:
                    gagne = resultat_marche({"bd": r[0], "be": r[1]}, pari["marche"])
                    pari["statut"] = "gagne" if gagne else "perdu"
                    pari["score_reel"] = f"{r[0]}-{r[1]}"
                    pari["retour"] = round(pari["mise"] * pari["cote"], 2) if gagne else 0.0
                else:
                    try:
                        trop_vieux = (auj - dt.date.fromisoformat(pari["date_match"])).days > 7
                    except Exception:
                        trop_vieux = False
                    if trop_vieux:  # match reporte ou introuvable : pari annule, mise rendue
                        pari["statut"] = "annule"
                        pari["retour"] = 0.0
        _recap_jour(info)

    # 2. placer les coups du jour, une seule fois
    cle = auj.isoformat()
    if cle not in jours:
        candidats = []
        for match in a_venir:
            if match.get("date") != cle:
                continue
            if match.get("fiabilite", {}).get("niveau") == "faible":
                continue  # parieur prudent : pas de pari quand les donnees sont trop minces
            for s in match.get("selections", []):
                if s.get("value", 0) >= SEUIL_VALUE_JOURNAL:
                    candidats.append((s["value"], match, s))
        candidats.sort(key=lambda x: -x[0])
        paris = []
        for value, match, s in candidats[:MAX_PARIS_JOUR]:
            paris.append({"date_match": match["date"], "heure": match.get("heure"),
                          "ligue": match["ligue"], "dom": match["dom"], "ext": match["ext"],
                          "marche": s["marche"], "cote": s["cote"], "proba": s["proba"],
                          "value": s["value"], "mise": MISE_PARI, "statut": "en_attente",
                          "retour": 0.0, "score_reel": None})
        info = {"capital_depart": CREDIT_JOUR, "paris": paris, "sans_pari": len(paris) == 0}
        _recap_jour(info)
        jours[cle] = info

    J["jours"] = jours
    J["maj"] = maintenant().strftime("%d/%m/%Y %H:%M")
    J["resume"] = _resume_global(jours)
    J["semaines"] = _bilans_semaine(jours)
    J["par_formule"] = _par_formule(jours)
    with open(JOURNAL, "w", encoding="utf-8") as f:
        json.dump(J, f, ensure_ascii=False, separators=(",", ":"))
    return J


def main():
    complet = "--complet" in sys.argv
    t0 = time.time()
    etat = {"fichiers_ok": 0, "fichiers_absents": [], "a_venir": None}
    mettre_a_jour_bibliotheque(complet, etat)
    par_ligue = charger_bibliotheque()
    nb = sum(len(v) for v in par_ligue.values())
    print(f"Bibliotheque football : {nb} matchs, {len(par_ligue)} championnats.")
    a_venir = matchs_a_venir(par_ligue)
    print(f"Matchs a venir analyses : {len(a_venir)}.")
    auj = maintenant().date()
    espn_idx = _besoins_espn_et_resultats(a_venir, auj)
    enrichis = 0
    for m in a_venir:
        if m["date"] == auj.isoformat() and not m.get("score_reel"):
            r = espn_chercher(espn_idx, m["date"], m["dom"], m["ext"])
            if r:
                m["score_reel"] = f"{r[0]}-{r[1]}"
                enrichis += 1
    print(f"Resultats ESPN rattaches aux matchs du jour : {enrichis}.")
    banc = banc_essai(par_ligue, auj - dt.timedelta(days=365))
    print(f"Banc d'essai 12 mois : {banc['paris']} paris, reussite {banc['reussite']}, rentabilite {banc['roi']}.")
    recent = bilan_recent(par_ligue)
    print(f"Bilan recent : {len(recent['recents'])} matchs affiches, gains simules {recent['gains']['total_net']} EUR sur {recent['gains']['jours']} j.")
    jrn = journal_virtuel(par_ligue, a_venir, espn_idx)
    rj = jrn["resume"]
    print(f"Journal virtuel : {len(jrn['jours'])} jours, {rj['paris']} paris soldes, "
          f"capital cumule {rj['capital_cumule']} EUR (depart 100/jour).")
    dates = [m["date"] for v in par_ligue.values() for m in v]
    os.makedirs(SORTIE, exist_ok=True)
    with open(os.path.join(SORTIE, "foot.json"), "w", encoding="utf-8") as f:
        json.dump({
            "maj": maintenant().strftime("%d/%m/%Y %H:%M"),
            "filtre": {"proba": SEUIL_PROBA, "value": SEUIL_VALUE},
            "bibliotheque": {"matchs": nb, "championnats": len(par_ligue),
                             "debut": min(dates).isoformat() if dates else None,
                             "fin": max(dates).isoformat() if dates else None},
            "a_venir": a_venir,
            "banc_essai": banc,
            "recents": recent["recents"],
            "gains": recent["gains"],
            "forces": classement_forces(par_ligue),
            "etat_sources": etat,
        }, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Termine en {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
