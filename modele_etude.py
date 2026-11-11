#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YANIS - modele « A L'ETUDE » (en attente de confirmation).

Idee : le marche (la cote finale) est deja tres precis. On ne cherche donc pas a le remplacer mais a mesurer
ce qu'il ne voit pas : pour chaque cheval, un modele part de la probabilite du marche et la corrige avec des
facteurs a effet durable (pere, mere, eleveur, proprietaire, driver, entraineur, duo driver-entraineur, corde par
hippodrome, ferrure, oeilleres, forme recente, poids, age...). Un modele DISTINCT est appris pour chaque famille :
attele, monte, plat, obstacle (le trot, avec ses disqualifications pour allure irreguliere, ne se comporte pas
comme le galop).

Verification : « marche en avant » trimestre par trimestre (le modele est appris sur le passe, teste sur le trimestre
suivant, jamais sur ce qu'il a vu). Un pari « valeur » = le modele voit le cheval au moins 30 % plus gagnant que le marche.

Sorties : docs/data/etude.json (courses du jour et du lendemain, fiabilite mesuree) et docs/data/etude_suivi.json
(journal fige AVANT chaque course : paris de l'etude et pronostic actuel, regles avec les vrais rapports).
"""
import datetime as dt
import glob
import gzip
import json
import math
import os
import re
import sys
import time
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss

DOS = os.path.dirname(os.path.abspath(__file__))
PARIS = ZoneInfo("Europe/Paris")
_SORTIE_DIR = os.environ.get("ETUDE_DIR") or os.path.join(DOS, "docs", "data")      # variables d'essai : rejouer une journee deja courue sans toucher aux vrais fichiers
SORTIE = os.path.join(_SORTIE_DIR, "etude.json")
SUIVI = os.path.join(_SORTIE_DIR, "etude_suivi.json")


def maintenant_paris():
    v = os.environ.get("ETUDE_MAINTENANT")
    return dt.datetime.fromisoformat(v).replace(tzinfo=PARIS) if v else dt.datetime.now(PARIS)
SEUIL = 1.3                      # le modele voit le cheval au moins 30 % plus gagnant que le marche
C_REG = 0.03                     # regularisation (forte : un effet rare doit etre confirme par beaucoup de courses)
MIN_TRAIN = {"ATTELE": 25000, "PLAT": 25000, "MONTE": 6000, "OBSTACLE": 8000}
MIN_TEST = {"ATTELE": 1500, "PLAT": 1500, "MONTE": 500, "OBSTACLE": 600}
GROUPES = {"ATTELE": "ATTELE", "MONTE": "MONTE", "PLAT": "PLAT", "HAIE": "OBSTACLE", "STEEPLECHASE": "OBSTACLE", "CROSS": "OBSTACLE"}
LIB_GROUPE = {"ATTELE": "Trot attelé", "MONTE": "Trot monté", "PLAT": "Galop plat", "OBSTACLE": "Obstacle (haies, steeple, cross)"}
CAT = ["driver", "entraineur", "proprietaire", "eleveur", "pere", "mere", "drv_ent", "hip_corde", "hip_disc_dist", "sexe", "deferre", "oeilleres", "race", "terr", "ciel"]
NUM = ["m_D5", "m_p5", "m_w5", "tx_v", "tx_p", "nb_courses", "gc_par", "corde_rel", "age", "poids_kg", "alloc", "temp"]
LIB_CAT = {"driver": "driver", "entraineur": "entraîneur", "proprietaire": "propriétaire", "eleveur": "éleveur", "pere": "père", "mere": "mère", "drv_ent": "duo driver-entraîneur",
           "hip_corde": "place à la corde sur ce parcours", "hip_disc_dist": "hippodrome et distance", "sexe": "sexe", "deferre": "ferrure", "oeilleres": "œillères", "race": "race", "terr": "terrain", "ciel": "ciel"}
LIB_NUM = {"m_D5": "disqualifications récentes", "m_p5": "places récentes", "m_w5": "victoires récentes", "tx_v": "taux de victoires", "tx_p": "taux de places", "nb_courses": "expérience",
           "gc_par": "gains par course", "corde_rel": "position à la corde", "age": "âge", "poids_kg": "poids porté", "alloc": "dotation", "temp": "température"}


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- 1. lecture des journees
def lire_jours():
    """Renvoie (partants de courses terminees, partants de courses programmees, dictionnaire des noms de reunions)."""
    fin, prog = [], []
    auj = maintenant_paris().strftime("%Y-%m-%d")
    rej = os.environ.get("ETUDE_REJOUER")
    for f in sorted(glob.glob(os.path.join(DOS, "donnees", "*", "*", "*.json.gz"))):
        try:
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                j = json.load(fh)
        except Exception:
            continue
        if not all(k in j for k in ("courses", "partants", "reunions")):
            continue
        date = j["date"]
        cc = j["courses"]["colonnes"]
        C = {(l[1], l[2]): dict(zip(cc, l)) for l in j["courses"]["lignes"]}
        rc = j["reunions"]["colonnes"]
        H = {l[1]: dict(zip(rc, l)) for l in j["reunions"]["lignes"]}
        SG, SP = {}, {}
        for l in (j.get("rapports") or {}).get("lignes", []):
            o = dict(zip(j["rapports"]["colonnes"], l))
            if o["pari"] == "SIMPLE_GAGNANT":
                SG[(o["r"], o["c"])] = (str(o["combinaison"]), o["rapport_pour_1e"])
            elif o["pari"] == "SIMPLE_PLACE":
                SP[(o["r"], o["c"], str(o["combinaison"]))] = o["rapport_pour_1e"]
        pc = j["partants"]["colonnes"]
        for l in j["partants"]["lignes"]:
            o = dict(zip(pc, l))
            k = (o["r"], o["c"])
            c = C.get(k)
            if not c or o["statut"] != "PARTANT":
                continue
            h = H.get(o["r"], {})
            o.update(dict(date=date, disc=c["discipline"], spec=c["specialite"], dist=c["distance"], terr=c["terrain"], alloc=c["allocation"], libelle=c["libelle"],
                          depart=c["depart"], hip=h.get("hippodrome_code"), hipnom=h.get("hippodrome"), pays=h.get("pays"), temp=h.get("meteo_temperature"),
                          ciel=h.get("meteo_ciel"), key="%s/%s/%s" % (date, k[0], k[1]), statut_c=c["statut"]))
            fini = k in SG and str(c["statut"]).startswith(("FIN_COURSE", "ARRIVEE_DEFINITIVE"))      # arrivee officielle et rapports connus
            if rej and date == rej and fini:
                o["cote"] = o["cote_finale"]
                prog.append(o)
            elif fini and (o["cote_finale"] or 0) > 1:
                o["cote"] = o["cote_finale"]
                o["win"] = 1 if str(o["num"]) == SG[k][0] else 0
                o["sg"] = SG[k][1] if o["win"] else 0.0
                fin.append(o)
            elif not fini and date >= auj and not str(c["statut"]).startswith(("FIN_COURSE", "ARRIVEE")):
                o["cote"] = None
                prog.append(o)
    return pd.DataFrame(fin), pd.DataFrame(prog)


def cotes_du_jour(date):
    """Cote actuelle de chaque cheval (derniere releve) pour une date, depuis donnees_cotes."""
    f = os.path.join(DOS, "donnees_cotes", date + ".json.gz")
    out = {}
    if not os.path.exists(f):
        return out
    try:
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            j = json.load(fh)
    except Exception:
        return out
    for rc, ch in j.items():
        m = re.match(r"R(\d+)C(\d+)", rc)
        if not m:
            continue
        for num, serie in ch.items():
            if serie:
                out[(date, int(m.group(1)), int(m.group(2)), int(num))] = float(serie[-1][1])
    return out


# ---------------------------------------------------------------- 2. facteurs
def musique(m):
    if not isinstance(m, str):
        return (np.nan,) * 4
    t = [x.upper() for x in re.findall(r"(\d{1,2}|[DATRdatr0])[a-zA-Z]", re.sub(r"\(\d+\)", "", m))]
    if not t:
        return (np.nan,) * 4
    f5 = t[:5]
    return (sum(1 for x in f5 if x == "D"), sum(1 for x in f5 if x.isdigit() and 1 <= int(x) <= 3), sum(1 for x in f5 if x == "1"), len(t))


def preparer(df):
    df = df.copy()
    df["groupe"] = df.disc.map(GROUPES)
    df = df[df.groupe.notna() & (df.cote > 1)].copy()
    df["q"] = 1 / df.cote
    df["p"] = df.q / df.groupby("key").q.transform("sum")
    df["n"] = df.groupby("key").num.transform("count")
    df["rk"] = df.groupby("key").cote.rank(method="first")
    mm = df.musique.map(musique)
    df["m_D5"] = [x[0] for x in mm]
    df["m_p5"] = [x[1] for x in mm]
    df["m_w5"] = [x[2] for x in mm]
    df["corde_rel"] = df.place_corde / df.n
    nb = df.nb_courses.clip(lower=1)
    df["tx_v"] = np.where(df.nb_courses >= 5, df.nb_victoires / nb, np.nan)
    df["tx_p"] = np.where(df.nb_courses >= 5, df.nb_places / nb, np.nan)
    df["gc_par"] = np.log1p((df.gains_carriere / nb).clip(lower=0))
    df["nb_courses"] = np.log1p(df.nb_courses.clip(lower=0))
    df["alloc"] = np.log1p(pd.to_numeric(df.alloc, errors="coerce").clip(lower=0))
    df["age"] = pd.to_numeric(df.age, errors="coerce")
    df["poids_kg"] = pd.to_numeric(df.poids_kg, errors="coerce")
    df["temp"] = pd.to_numeric(df.temp, errors="coerce")
    df["drv_ent"] = df.driver.astype(str) + "|" + df.entraineur.astype(str)
    dd = df.hip.astype(str) + "|" + df.disc.astype(str) + "|" + pd.cut(df.dist, [0, 1300, 1700, 2100, 2600, 3200, 9999], labels=False).astype(str)
    df["hip_disc_dist"] = dd
    df["hip_corde"] = dd + "|" + pd.cut(df.corde_rel, [0, .2, .4, .6, .8, 1.01], labels=False).astype(str)
    df["lp"] = np.log(df.p / (1 - df.p))
    return df


# ---------------------------------------------------------------- 3. modele
class Modele:
    def __init__(self, tr):
        self.blocs = []
        for c in CAT:
            vc = tr[c].astype(str).value_counts()
            self.blocs.append((c, {k: i for i, k in enumerate(vc[vc >= 40].index)}))
        self.mu = tr[NUM].mean()
        self.sd = tr[NUM].std().replace(0, 1).fillna(1)
        self.noms = ["lp"] + ["%s=%s" % (c, k) for c, m in self.blocs for k in m] + list(NUM)
        self.m = LogisticRegression(C=C_REG, max_iter=300).fit(self.X(tr), tr.win)

    def X(self, d):
        mats = []
        for c, m in self.blocs:
            ix = d[c].astype(str).map(m)
            ok = ix.notna().values
            r = np.where(ok)[0]
            mats.append(sp.csr_matrix((np.ones(len(r)), (r, ix.values[ok].astype(int))), shape=(len(d), len(m))))
        nu = ((d[NUM] - self.mu) / self.sd).fillna(0).values * 0.3
        return sp.hstack([sp.csr_matrix(d[["lp"]].values * 6)] + mats + [sp.csr_matrix(nu)]).tocsr()

    def predire(self, d):
        pm = self.m.predict_proba(self.X(d))[:, 1]
        pm = pd.Series(pm, index=d.index)
        return pm / pm.groupby(d.key).transform("sum")

    def raisons(self, d, i, k=3):
        """Les facteurs qui poussent le plus la probabilite vers le haut / le bas pour une ligne (explication du pari)."""
        x = self.X(d.iloc[[i]]).tocoo()
        coef = self.m.coef_[0]
        L = []
        for j, v in zip(x.col, x.data):
            if j == 0:
                continue
            nom = self.noms[j]
            w = coef[j] * v
            if abs(w) < 0.02:
                continue
            if "=" in nom:
                c, val = nom.split("=", 1)
                if c in ("hip_corde", "hip_disc_dist"):
                    L.append((w, LIB_CAT[c]))
                else:
                    L.append((w, "%s %s" % (LIB_CAT.get(c, c), val.replace("|", " / ").replace("_", " ").lower() if c in ("deferre", "oeilleres", "sexe", "race") else val.replace("|", " / "))))
            else:
                L.append((w, LIB_NUM.get(nom, nom)))
        L.sort(key=lambda t: -t[0])
        pos = [{"t": t, "w": round(float(w), 3)} for w, t in L if w > 0][:k]
        neg = [{"t": t, "w": round(float(w), 3)} for w, t in sorted(L, key=lambda t: t[0]) if w < 0][:2]
        return pos, neg


def stats_paris(g):
    n = len(g)
    if n < 30:
        return None
    roi = g.sg.sum() / n - 1
    ci = 1.96 * g.sg.std() / math.sqrt(n)
    return {"paris": n, "gagnes": int(g.win.sum()), "reussite": round(float(g.win.mean()), 4), "annonce_marche": round(float(g.p.mean()), 4),
            "annonce_etude": round(float(g.pm.mean()), 4), "cote_moy": round(float(g.cote.mean()), 1), "roi": round(float(roi), 4), "marge": round(float(ci), 4)}


def verifier(fin, groupe):
    """Marche en avant, trimestre par trimestre, pour une famille."""
    d = fin[fin.groupe == groupe].copy()
    d["trim"] = pd.PeriodIndex(d.date.str[:7], freq="M").asfreq("Q").astype(str)
    out = []
    for q in sorted(d.trim.unique()):
        tr, te = d[d.trim < q], d[d.trim == q]
        if len(tr) < MIN_TRAIN[groupe] or len(te) < MIN_TEST[groupe]:
            continue
        te = te.copy()
        te["pm"] = Modele(tr).predire(te)
        out.append(te)
    if not out:
        return None
    T = pd.concat(out)
    T["r"] = T.pm / T.p
    res = {"courses": int(T.key.nunique()), "partants": int(len(T)),
           "logloss_marche": round(float(log_loss(T.win, T.p.clip(1e-4, 1 - 1e-4))), 5), "logloss_etude": round(float(log_loss(T.win, T.pm.clip(1e-4, 1 - 1e-4))), 5),
           "valeur": stats_paris(T[T.r >= SEUIL]), "valeur_1_5": stats_paris(T[T.r >= 1.5]), "tous": stats_paris(T)}
    par_trim = {}
    for q, g in T[T.r >= SEUIL].groupby("trim"):
        if len(g) >= 20:
            par_trim[q] = [len(g), round(float(g.sg.sum() / len(g) - 1), 3)]
    res["par_trimestre"] = par_trim
    v = res["valeur"]
    res["verdict"] = "confirme" if v and v["roi"] - v["marge"] > 0 else ("prometteur" if v and v["roi"] > 0 and v["paris"] >= 300 else "a_confirmer")
    return res


def profil_groupes(fin):
    out = {}
    for g, d in fin.groupby("groupe"):
        fav = d[d.rk == 1]
        dq = (d.incident == "DISQUALIFIE_POUR_ALLURE_IRREGULIERE").mean() if "incident" in d else np.nan
        dqf = (fav.incident == "DISQUALIFIE_POUR_ALLURE_IRREGULIERE").mean() if "incident" in fav else np.nan
        inc = d.incident.notna() & (d.incident != "NON_PARTANT") if "incident" in d else pd.Series(False, index=d.index)
        incf = fav.incident.notna() & (fav.incident != "NON_PARTANT") if "incident" in fav else pd.Series(False, index=fav.index)
        out[g] = {"nom": LIB_GROUPE[g], "courses": int(d.key.nunique()), "favori_gagne": round(float(fav.win.mean()), 3), "disqualifies": round(float(dq), 4), "favori_disqualifie": round(float(dqf), 4),
                  "incidents": round(float(inc.mean()), 4), "favori_incident": round(float(incf.mean()), 4)}
    return out


# ---------------------------------------------------------------- 4. journal fige avant chaque course
def charger_suivi():
    try:
        with open(SUIVI, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"depuis": dt.datetime.now(PARIS).strftime("%d/%m/%Y"), "etude": {}, "actuel": {}}


def pronostic_actuel():
    """Pronostic en vigueur dans l'appli : le n°1 de chaque course (hippique_v2.json), pour comparer."""
    try:
        with open(os.path.join(DOS, "docs", "data", "hippique_v2.json"), encoding="utf-8") as fh:
            h = json.load(fh)
    except Exception:
        return []
    out = []
    for c in h.get("courses", []):
        cl = c.get("classement") or []
        if not cl or not c.get("date"):
            continue
        t = max(cl, key=lambda x: x.get("p_gagnant") or 0)
        if t.get("cote"):
            out.append({"key": "%s/%s/%s" % (c["date"], c["r"], c["c"]), "num": int(t["num"]), "nom": t.get("nom"), "cote": t["cote"], "p": t.get("p_gagnant")})
    return out


def regler(suivi, fin_idx, fins_cles, ref_noms):
    """Regle les paris deja figes : gagne / perdu / rembourse, avec le vrai rapport simple gagnant."""
    for src in ("etude", "actuel"):
        for kid, e in suivi[src].items():
            if e.get("statut") != "en_cours":
                continue
            ck = e["key"]
            if ck not in fins_cles:
                continue
            row = fin_idx.get((ck, e["num"]))
            if row is None:
                e["statut"], e["retour"] = "rembourse", 1.0
            else:
                e["statut"] = "gagne" if row[0] else "perdu"
                e["retour"] = float(row[1])


def resume_suivi(suivi):
    out = {}
    for src in ("etude", "actuel"):
        L = [e for e in suivi[src].values() if e["statut"] in ("gagne", "perdu", "rembourse")]
        mise = sum(1 for e in L)
        ret = sum(e["retour"] for e in L)
        n_g = sum(1 for e in L if e["statut"] == "gagne")
        cours = sorted(suivi[src].values(), key=lambda e: e["prise_le"], reverse=True)[:60]
        out[src] = {"paris": len(L), "gagnes": n_g, "mise": mise, "retour": round(ret, 2), "roi": round(ret / mise - 1, 4) if mise else None,
                    "en_cours": sum(1 for e in suivi[src].values() if e["statut"] == "en_cours"), "derniers": cours}
    return out


# ---------------------------------------------------------------- 5. principal
def main():
    t0 = time.time()
    maintenant = maintenant_paris()
    fin, prog = lire_jours()
    log("courses terminees : %d partants ; courses a venir : %d partants (%.0f s)" % (len(fin), len(prog), time.time() - t0))
    fin = preparer(fin)
    prof = profil_groupes(fin)
    # fiabilite : recalculee au plus une fois par 20 h
    ancien = {}
    try:
        with open(SORTIE, encoding="utf-8") as fh:
            ancien = json.load(fh)
    except Exception:
        pass
    fiab = ancien.get("fiabilite")
    fiab_maj = ancien.get("fiabilite_maj")
    vieux = True
    if fiab and fiab_maj:
        try:
            vieux = (maintenant - dt.datetime.fromisoformat(fiab_maj)).total_seconds() > 20 * 3600
        except Exception:
            pass
    if vieux or "--verifier" in sys.argv:
        fiab = {}
        for g in GROUPES.values():
            if g in fiab:
                continue
            r = verifier(fin, g)
            if r:
                fiab[g] = r
                log(g, "verifie :", r["valeur"], r["verdict"], "(%.0f s)" % (time.time() - t0))
        fiab_maj = maintenant.isoformat(timespec="seconds")

    # journal : regler les paris deja faits
    suivi = charger_suivi()
    fin_idx = {(r.key, int(r.num)): (r.win, r.sg) for r in fin[["key", "num", "win", "sg"]].itertuples(index=False)}
    fins_cles = set(fin.key.unique())
    regler(suivi, fin_idx, fins_cles, None)

    # courses a venir
    courses = []
    if len(prog):
        cotes = {}
        for d in sorted(prog.date.unique()):
            cotes.update(cotes_du_jour(d))
        prog["cote"] = [cotes.get((r.date, r.r, r.c, int(r.num)), r.cote) for r in prog.itertuples(index=False)]
        decl = prog.groupby("key").num.transform("count")
        avec = prog.groupby("key").cote.transform(lambda x: x.notna().sum())
        prog = prog[prog.cote.notna() & (avec >= 0.9 * decl)].copy()      # une course n'est jugee que si (presque) tous les partants ont une cote
        # une course n'est utilisable que si presque tous les partants ont une cote
        prog = preparer(prog) if len(prog) else prog
        if len(prog):
            tot = prog.groupby("key").num.transform("count")
            prog = prog[tot >= 4].copy()
    modeles = {}
    if len(prog):
        prog["pm"] = np.nan
        for g in prog.groupe.unique():
            d = fin[fin.groupe == g]
            if len(d) < MIN_TRAIN[g]:
                continue
            modeles[g] = Modele(d)
            m = prog.groupe == g
            prog.loc[m, "pm"] = modeles[g].predire(prog[m])
        prog["ratio"] = prog.pm / prog.p
        for key, g in prog.groupby("key", sort=False):
            g = g.sort_values("pm", ascending=False)
            f = g.iloc[0]
            if g.pm.isna().all():
                continue
            depart = f.depart
            try:
                t_dep = dt.datetime.strptime(depart, "%Y-%m-%d %H:%M").replace(tzinfo=PARIS)
            except Exception:
                t_dep = None
            avenir = t_dep is None or t_dep > maintenant
            picks = []
            for i, (idx, h) in enumerate(g.iterrows()):
                if h.ratio >= SEUIL and avenir and h.groupe in modeles:
                    pos, neg = modeles[h.groupe].raisons(prog, prog.index.get_loc(idx))
                    picks.append({"num": int(h.num), "nom": h.nom, "cote": float(h.cote), "pm": round(float(h.p), 4), "pe": round(float(h.pm), 4), "ratio": round(float(h.ratio), 2), "pour": pos, "contre": neg})
            ck = key
            for pk in picks:
                kid = "%s#%d" % (ck, pk["num"])
                if kid not in suivi["etude"]:
                    suivi["etude"][kid] = {"key": ck, "num": pk["num"], "nom": pk["nom"], "cote": pk["cote"], "pm": pk["pm"], "pe": pk["pe"], "groupe": f.groupe, "course": "%s R%s C%s" % (f.hipnom, f.r, f.c),
                                            "depart": depart, "prise_le": maintenant.isoformat(timespec="minutes"), "statut": "en_cours", "retour": None}
            courses.append({"key": ck, "date": f.date, "r": int(f.r), "c": int(f.c), "hippodrome": f.hipnom, "libelle": f.libelle, "depart": depart, "groupe": f.groupe, "n": int(f.n), "avenir": bool(avenir),
                            "top": [{"num": int(h.num), "nom": h.nom, "cote": float(h.cote), "pm": round(float(h.p), 4), "pe": round(float(h.pm), 4)} for h in g.head(3).itertuples(index=False) if not pd.isna(h.pm)],
                            "picks": picks})
        courses.sort(key=lambda c: (c["depart"] or "", c["r"], c["c"]))

    # pronostic actuel de l'appli (n°1), fige avant la course, meme regle de comparaison
    for p in pronostic_actuel():
        kid = "%s#%d" % (p["key"], p["num"])
        if kid in suivi["actuel"]:
            continue
        dep = next((c["depart"] for c in courses if c["key"] == p["key"]), None)
        if dep is None:
            continue
        try:
            if dt.datetime.strptime(dep, "%Y-%m-%d %H:%M").replace(tzinfo=PARIS) <= maintenant:
                continue
        except Exception:
            continue
        suivi["actuel"][kid] = {"key": p["key"], "num": p["num"], "nom": p["nom"], "cote": p["cote"], "pm": None, "pe": p.get("p"), "groupe": None, "course": p["key"], "depart": dep,
                                "prise_le": maintenant.isoformat(timespec="minutes"), "statut": "en_cours", "retour": None}
    regler(suivi, fin_idx, fins_cles, None)
    # on ne garde que les 4000 derniers paris par source
    for src in ("etude", "actuel"):
        if len(suivi[src]) > 4000:
            ks = sorted(suivi[src], key=lambda k: suivi[src][k]["prise_le"])[-4000:]
            suivi[src] = {k: suivi[src][k] for k in ks}
    os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
    with open(SUIVI, "w", encoding="utf-8") as fh:
        json.dump(suivi, fh, ensure_ascii=False)
    sortie = {"maj": maintenant.isoformat(timespec="seconds"), "statut": "a_l_etude", "seuil": SEUIL, "depuis": suivi["depuis"], "fiabilite_maj": fiab_maj,
              "histoire": {"partants": int(len(fin)), "courses": int(fin.key.nunique()), "debut": fin.date.min(), "fin": fin.date.max()},
              "groupes": prof, "fiabilite": fiab, "courses": courses, "suivi": resume_suivi(suivi)}
    with open(SORTIE, "w", encoding="utf-8") as fh:
        json.dump(sortie, fh, ensure_ascii=False)
    log("etude.json ecrit :", len(courses), "courses,", sum(len(c["picks"]) for c in courses), "paris valeur,", "%.0f s" % (time.time() - t0))


if __name__ == "__main__":
    main()
