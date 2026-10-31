#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YANIS - Etape 2 : le vrai modele hippique.

1. Pour chaque partant, des dizaines d'indices calcules UNIQUEMENT avec le passe
   (aucune information de l'avenir ne fuit) : forme, musique, driver, entraineur,
   duo driver-entraineur, ferrure (et deferre pour la premiere fois), recul, distance,
   hippodrome, repos, changement de driver, cote du marche...
2. Un modele d'apprentissage (gradient boosting) apprend qui gagne et qui se place.
3. Banc d'essai mois par mois : le modele est entraine sur les mois passes et teste
   sur le mois suivant, qu'il n'a jamais vu. Les gains sont calcules avec les VRAIS
   rapports PMU de chaque formule.
4. On ne garde que les strategies rentables sur ce banc d'essai.

Sortie : docs/data/hippique_v2.json (banc d'essai + pronostics du jour)
"""

import datetime as dt
import json
import math
import os
import re
import sys
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yanis  # noqa: E402

SORTIE = os.path.join(yanis.DOSSIER, "docs", "data")
MOIS_MINI_ENTRAINEMENT = 2
MOIS_TESTES = 6          # le banc d'essai porte sur les 6 derniers mois
FENETRE_MOIS = 24        # le modele apprend sur les 24 derniers mois


# --------------------------------------------------------------------------
# 1. Donnees
# --------------------------------------------------------------------------

def charger():
    con, _, _ = yanis.charger_tout()
    p = pd.read_sql_query("""
        SELECT p.*, c.discipline, c.specialite, c.distance, c.partants AS nb_declares, c.allocation,
               c.arrivee, c.depart, c.corde AS sens, c.terrain, c.categorie, r.hippodrome_code
        FROM partants p JOIN courses c USING (date, r, c) JOIN reunions r USING (date, r)
        WHERE p.statut = 'PARTANT'""", con)
    rap = pd.read_sql_query("SELECT date, r, c, pari, libelle, combinaison, rapport_pour_1e FROM rapports", con)
    return p, rap


def norm_nom(x):
    if not isinstance(x, str):
        return None
    return re.sub(r"\s+", " ", x.replace(".", ". ")).strip().upper() or None


def forme_musique(m, n=6):
    """Places des n dernieres courses dans la musique (0 = pas classe)."""
    if not isinstance(m, str) or not m:
        return []
    m = re.sub(r"\(\d+\)", "", m)
    out = []
    for car, _ in re.findall(r"([0-9DATRS])([a-zA-Z])", m)[:n]:
        out.append(int(car) if car.isdigit() and car != "0" else 0)
    return out


def preparer(p):
    p = p.copy()
    p["jour"] = pd.to_datetime(p["date"])
    p["cle"] = p["date"] + "/" + p["r"].astype(str) + "/" + p["c"].astype(str)
    p["driver_n"] = p["driver"].map(norm_nom)
    p["entraineur_n"] = p["entraineur"].map(norm_nom)
    p["gagne"] = (p["place_arrivee"] == 1).astype(int)
    p["place3"] = p["place_arrivee"].between(1, 3).astype(int)
    p["fini"] = p["arrivee"].notna()
    p["nb_partants"] = p.groupby("cle")["num"].transform("count")
    p = p.sort_values(["depart", "cle", "num"]).reset_index(drop=True)

    # --- marche ---
    cote = p["cote_finale"].fillna(p["cote_reference"])
    p["cote"] = cote
    inv = 1 / cote.where(cote > 1)
    p["p_marche"] = inv / inv.groupby(p["cle"]).transform("sum")
    p["rang_cote"] = cote.groupby(p["cle"]).rank(method="min")
    p["log_cote"] = np.log(cote.clip(lower=1.01))
    p["p_marche_matin"] = (1 / p["cote_reference"].where(p["cote_reference"] > 1)) / \
        (1 / p["cote_reference"].where(p["cote_reference"] > 1)).groupby(p["cle"]).transform("sum")
    p["derive_cote"] = np.log(p["cote_reference"].clip(lower=1.01)) - p["log_cote"]  # >0 : le cheval a ete joue

    # --- musique (connue avant la course) ---
    mus = p["musique"].map(forme_musique)
    p["mus_n"] = mus.map(len)
    for k in range(3):
        p[f"mus_{k}"] = mus.map(lambda x, k=k: x[k] if len(x) > k else -1)
    p["mus_moy"] = mus.map(lambda x: np.mean([v if v else 10 for v in x]) if x else np.nan)
    p["mus_vict"] = mus.map(lambda x: sum(v == 1 for v in x))
    p["mus_podium"] = mus.map(lambda x: sum(1 <= v <= 3 for v in x))
    p["mus_dq"] = p["musique"].fillna("").str.count(r"D[a-z]")

    # --- equipement ---
    d = p["deferre"].fillna("")
    p["d4"] = d.str.contains("DEFERRE_ANTERIEURS_POSTERIEURS").astype(int)
    p["d_ant"] = d.str.contains("DEFERRE_ANTERIEURS").astype(int)
    p["d_post"] = d.str.contains("POSTERIEURS").astype(int) & d.str.contains("DEFERRE").astype(int)
    p["oeil"] = (p["oeilleres"].fillna("SANS_OEILLERES") != "SANS_OEILLERES").astype(int)

    # --- historique propre a la bibliotheque (strictement avant la course) ---
    p["ts"] = pd.to_datetime(p["depart"], errors="coerce").fillna(p["jour"])
    for col, cle in (("ch", "nom"), ("dr", "driver_n"), ("en", "entraineur_n")):
        g = p.groupby(cle, sort=False)
        p[f"{col}_courses"] = g.cumcount()
        p[f"{col}_vict"] = g["gagne"].cumsum() - p["gagne"]
        p[f"{col}_plac"] = g["place3"].cumsum() - p["place3"]
        base_v, base_p, k = 0.1, 0.3, 15
        p[f"{col}_tx_v"] = (p[f"{col}_vict"] + k * base_v) / (p[f"{col}_courses"] + k)
        p[f"{col}_tx_p"] = (p[f"{col}_plac"] + k * base_p) / (p[f"{col}_courses"] + k)
    # duo driver-entraineur
    p["duo"] = p["driver_n"].fillna("") + "|" + p["entraineur_n"].fillna("")
    g = p.groupby("duo", sort=False)
    p["duo_courses"] = g.cumcount()
    p["duo_tx_v"] = ((g["gagne"].cumsum() - p["gagne"]) + 1.5) / (p["duo_courses"] + 15)

    # derniere course du cheval dans la bibliotheque
    g = p.groupby("nom", sort=False)
    prev_ts = g["ts"].shift(1)
    p["repos_j"] = (p["ts"] - prev_ts).dt.days
    p["dist_prec"] = g["distance"].shift(1)
    p["delta_dist"] = p["distance"] - p["dist_prec"]
    p["chg_driver"] = (g["driver_n"].shift(1) != p["driver_n"]).astype(float).where(prev_ts.notna())
    p["d4_prec"] = g["d4"].shift(1)
    p["d4_nouveau"] = ((p["d4"] == 1) & (p["d4_prec"] == 0)).astype(int)
    p["place_prec"] = g["place_arrivee"].shift(1).fillna(0)
    p["meme_hippo"] = (g["hippodrome_code"].shift(1) == p["hippodrome_code"]).astype(float).where(prev_ts.notna())
    p["cote_prec"] = g["cote"].shift(1)
    p["gains_par_course"] = p["gains_carriere"] / p["nb_courses"].replace(0, np.nan)

    # --- note de vitesse (trot) : reduction km comparee a la reference hippodrome + distance ---
    # reference = moyenne des reductions des 3 premiers, sur les courses PASSEES du meme hippodrome,
    # meme discipline, meme tranche de distance (aucune fuite de l'avenir)
    p["tranche_dist"] = (p["distance"] // 300) * 300
    p["piste"] = p["hippodrome_code"].fillna("?") + "|" + p["discipline"].fillna("?") + "|" + p["tranche_dist"].astype(str)
    top3 = p["place_arrivee"].between(1, 3) & p["reduction_km_s"].notna()
    ref = (p[top3].groupby(["piste", "date"])["reduction_km_s"].mean().rename("ref_jour").reset_index()
           .sort_values("date"))
    ref["ref_cum"] = ref.groupby("piste")["ref_jour"].transform(lambda x: x.shift(1).expanding().mean())
    ref["ref_n"] = ref.groupby("piste").cumcount()
    p = p.merge(ref[["piste", "date", "ref_cum", "ref_n"]], on=["piste", "date"], how="left")
    # reference globale par discipline/distance si la piste est trop peu connue
    p["note_vitesse"] = np.where(p["ref_n"] >= 3, p["ref_cum"] - p["reduction_km_s"], np.nan)
    p = p.sort_values(["ts", "cle", "num"]).reset_index(drop=True)
    g = p.groupby("nom", sort=False)["note_vitesse"]
    p["vit_derniere"] = g.shift(1)
    p["vit_moy3"] = g.transform(lambda x: x.shift(1).rolling(3, min_periods=1).mean())
    p["vit_max5"] = g.transform(lambda x: x.shift(1).rolling(5, min_periods=1).max())
    p["vit_n"] = g.transform(lambda x: x.shift(1).notna().cumsum())
    p["vit_tendance"] = p["vit_derniere"] - p["vit_moy3"]

    # rang du cheval dans sa course sur quelques indices cles
    for col in ("vit_max5", "vit_moy3"):
        p[f"rg_{col}"] = p.groupby("cle")[col].rank(pct=True)
        p[f"ecart_{col}"] = p[col] - p.groupby("cle")[col].transform("max")
    for col in ("gains_par_course", "dr_tx_v", "en_tx_v", "mus_moy"):
        p[f"rg_{col}"] = p.groupby("cle")[col].rank(pct=True)

    p["disc"] = p["discipline"].astype("category").cat.codes
    p["sexe_c"] = p["sexe"].astype("category").cat.codes
    return p


VARIABLES = [
    "p_marche", "log_cote", "rang_cote", "p_marche_matin", "derive_cote",
    "mus_n", "mus_0", "mus_1", "mus_2", "mus_moy", "mus_vict", "mus_podium", "mus_dq",
    "d4", "d_ant", "d_post", "oeil", "d4_nouveau",
    "ch_courses", "ch_tx_v", "ch_tx_p", "dr_courses", "dr_tx_v", "dr_tx_p", "en_courses", "en_tx_v", "en_tx_p",
    "duo_courses", "duo_tx_v", "repos_j", "delta_dist", "chg_driver", "place_prec", "meme_hippo", "cote_prec",
    "age", "sexe_c", "disc", "distance", "nb_partants", "recul_m", "poids_kg", "place_corde", "allocation",
    "gains_carriere", "gains_par_course", "nb_courses", "nb_victoires", "nb_places",
    "rg_gains_par_course", "rg_dr_tx_v", "rg_en_tx_v", "rg_mus_moy",
    "vit_derniere", "vit_moy3", "vit_max5", "vit_n", "vit_tendance",
    "rg_vit_max5", "rg_vit_moy3", "ecart_vit_max5", "ecart_vit_moy3",
]


def modele(cible):
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.04, max_leaf_nodes=31,
                                          min_samples_leaf=60, l2_regularization=1.0, random_state=0)


def probas_course(df, score_col):
    """Normalise les scores dans chaque course pour que la somme fasse 1 (ou 3 pour le podium)."""
    s = df[score_col]
    return s / s.groupby(df["cle"]).transform("sum")


# --------------------------------------------------------------------------
# 2. Strategies testees avec les vrais rapports
# --------------------------------------------------------------------------

def index_rapports(rap):
    idx = {}
    for row in rap.itertuples(index=False):
        idx.setdefault((f"{row.date}/{row.r}/{row.c}", row.pari), []).append((row.libelle, row.combinaison, row.rapport_pour_1e))
    return idx


def combo(x):
    return frozenset(int(v) for v in re.findall(r"\d+", x or ""))


def gain(idx, cle, pari, chevaux, libelle_contient=None):
    """Rapport pour 1 EUR si la combinaison jouee est payee, sinon 0."""
    jeu = frozenset(chevaux)
    for lib, comb, rap in idx.get((cle, pari), []):
        if rap is None or (libelle_contient and libelle_contient not in (lib or "")):
            continue
        if pari in ("SIMPLE_GAGNANT", "SIMPLE_PLACE"):
            if combo(comb) == jeu:
                return rap
        elif pari == "MULTI":
            if combo(comb) <= jeu and len(jeu) == 4:
                return rap
        elif combo(comb) == jeu:
            return rap
    return 0.0


STRATEGIES = {
    "sg_value": "Simple gagnant quand la cote paie plus que le risque (value 10 %+)",
    "sg_top": "Simple gagnant sur le n°1 Yanis",
    "sp_top": "Simple placé sur le n°1 Yanis",
    "sp_value": "Simple placé quand Yanis le voit placé bien plus souvent que le marché",
    "cp_top2": "Couplé placé avec les 2 premiers Yanis",
    "deux_sur_4": "2 sur 4 avec les 2 premiers Yanis",
    "trio_top3": "Trio avec les 3 premiers Yanis",
    "multi4_top4": "Multi en 4 avec les 4 premiers Yanis",
}


def jouer(course, idx):
    """Paris de chaque strategie pour une course : liste (strategie, mise, retour)."""
    cle = course["cle"].iloc[0]
    tri = course.sort_values("p_v2", ascending=False)
    nums = tri["num"].tolist()
    n = len(nums)
    out = []
    top = tri.iloc[0]
    out.append(("sg_top", 1, gain(idx, cle, "SIMPLE_GAGNANT", [nums[0]])))
    for row in tri.itertuples():
        if row.cote and row.p_v2 * row.cote >= 1.10 and row.p_v2 >= 0.08:
            out.append(("sg_value", 1, gain(idx, cle, "SIMPLE_GAGNANT", [row.num])))
    if n >= 4:
        out.append(("sp_top", 1, gain(idx, cle, "SIMPLE_PLACE", [nums[0]])))
        for row in tri.itertuples():
            if row.pp_v2 >= 0.45 and row.pp_v2 >= 1.25 * (row.p_marche_place or 0):
                out.append(("sp_value", 1, gain(idx, cle, "SIMPLE_PLACE", [row.num])))
    if n >= 4:
        out.append(("cp_top2", 1, gain(idx, cle, "COUPLE_PLACE", nums[:2])))
        out.append(("deux_sur_4", 1, gain(idx, cle, "DEUX_SUR_QUATRE", nums[:2])))
    if n >= 3:
        out.append(("trio_top3", 1, gain(idx, cle, "TRIO", nums[:3])))
    if n >= 4:
        out.append(("multi4_top4", 1, gain(idx, cle, "MULTI", nums[:4], "Multi en 4")))
    return out


# --------------------------------------------------------------------------
# 3. Banc d'essai mois par mois
# --------------------------------------------------------------------------

def entrainer_et_predire(train, test):
    X, Xt = train[VARIABLES], test[VARIABLES]
    mv = modele("gagne").fit(X, train["gagne"])
    mp = modele("place3").fit(X, train["place3"])
    test = test.copy()
    test["s_v"] = mv.predict_proba(Xt)[:, 1]
    test["s_p"] = mp.predict_proba(Xt)[:, 1]
    test["p_v2"] = probas_course(test, "s_v")
    k = np.minimum(3, test.groupby("cle")["num"].transform("count"))
    test["pp_v2"] = (test["s_p"] / test.groupby("cle")["s_p"].transform("sum") * k).clip(upper=0.98)
    return test


def banc_essai(p, rap):
    idx = index_rapports(rap)
    finis = p[p["fini"]].copy()
    finis["mois"] = finis["date"].str[:7]
    mois = sorted(finis["mois"].unique())
    # proba "placee" implicite du marche (approximation) pour la strategie sp_value
    res = {k: {"paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0, "par_mois": {}} for k in STRATEGIES}
    stats_modele = {"courses": 0, "n1_gagne": 0, "fav_gagne": 0, "logloss_modele": 0.0, "logloss_marche": 0.0}
    for i, m in enumerate(mois):
        if i < max(MOIS_MINI_ENTRAINEMENT, len(mois) - MOIS_TESTES):
            continue
        train = finis[(finis["mois"] < m) & (finis["mois"] >= mois[max(0, i - FENETRE_MOIS)])]
        test = finis[finis["mois"] == m]
        if len(test) < 200:
            continue
        test = entrainer_et_predire(train, test)
        test["p_marche_place"] = (test["p_marche"] * 2.6).clip(upper=0.95)
        for cle, course in test.groupby("cle", sort=False):
            if course["gagne"].sum() != 1 or course["p_marche"].isna().any():
                continue
            stats_modele["courses"] += 1
            stats_modele["n1_gagne"] += int(course.loc[course["p_v2"].idxmax(), "gagne"])
            stats_modele["fav_gagne"] += int(course.loc[course["p_marche"].idxmax(), "gagne"])
            g = course[course["gagne"] == 1].iloc[0]
            stats_modele["logloss_modele"] -= math.log(max(g["p_v2"], 1e-4))
            stats_modele["logloss_marche"] -= math.log(max(g["p_marche"], 1e-4))
            for strat, mise, retour in jouer(course, idx):
                r = res[strat]
                r["paris"] += 1; r["gagnes"] += int(retour > 0); r["mise"] += mise; r["retour"] += retour
                pm = r["par_mois"].setdefault(m, [0, 0.0, 0.0])
                pm[0] += 1; pm[1] += mise; pm[2] += retour
    n = stats_modele["courses"]
    sortie = {
        "mois_testes": [m for i, m in enumerate(mois) if i >= max(MOIS_MINI_ENTRAINEMENT, len(mois) - MOIS_TESTES)],
        "courses": n,
        "n1_yanis_gagne": round(stats_modele["n1_gagne"] / n, 3) if n else None,
        "favori_gagne": round(stats_modele["fav_gagne"] / n, 3) if n else None,
        "precision_vs_marche": round((stats_modele["logloss_marche"] - stats_modele["logloss_modele"]) / n, 4) if n else None,
        "strategies": {},
    }
    for k, r in res.items():
        roi = (r["retour"] - r["mise"]) / r["mise"] if r["mise"] else None
        mois_positifs = sum(1 for v in r["par_mois"].values() if v[2] > v[1])
        sortie["strategies"][k] = {
            "nom": STRATEGIES[k], "paris": r["paris"], "reussite": round(r["gagnes"] / r["paris"], 3) if r["paris"] else None,
            "roi": round(roi, 4) if roi is not None else None,
            "mois_positifs": mois_positifs, "mois": len(r["par_mois"]),
            "validee": bool(roi is not None and roi > 0.02 and r["paris"] >= 150 and mois_positifs >= max(2, len(r["par_mois"]) - 1)),
        }
    return sortie


# --------------------------------------------------------------------------
# 4. Pronostics du jour avec le modele entraine sur tout le passe
# --------------------------------------------------------------------------

def pronostics(p, banc):
    auj = yanis.aujourdhui().isoformat()
    debut = (yanis.aujourdhui() - dt.timedelta(days=30 * FENETRE_MOIS)).isoformat()
    train = p[p["fini"] & (p["date"] < auj) & (p["date"] >= debut)]
    test = p[(p["date"] >= auj)]
    if test.empty or len(train) < 5000:
        return []
    test = entrainer_et_predire(train, test)
    validees = {k for k, v in banc["strategies"].items() if v["validee"]}
    out = []
    for cle, course in test.groupby("cle", sort=False):
        tri = course.sort_values("p_v2", ascending=False)
        nums = tri["num"].tolist()
        conseils = []
        for row in tri.itertuples():
            if row.cote and row.p_v2 * row.cote >= 1.10 and row.p_v2 >= 0.08:
                conseils.append({"strategie": "sg_value", "chevaux": [int(row.num)], "texte": f"Simple gagnant n°{row.num}"})
        if len(nums) >= 4:
            conseils += [
                {"strategie": "sp_top", "chevaux": nums[:1], "texte": f"Simple placé n°{nums[0]}"},
                {"strategie": "cp_top2", "chevaux": nums[:2], "texte": f"Couplé placé {nums[0]}-{nums[1]}"},
                {"strategie": "deux_sur_4", "chevaux": nums[:2], "texte": f"2 sur 4 {nums[0]}-{nums[1]}"},
                {"strategie": "multi4_top4", "chevaux": nums[:4], "texte": "Multi en 4 " + "-".join(map(str, nums[:4]))},
            ]
        for cns in conseils:
            cns["validee"] = cns["strategie"] in validees
            cns["chevaux"] = [int(x) for x in cns["chevaux"]]
        out.append({
            "date": course["date"].iloc[0], "r": int(course["r"].iloc[0]), "c": int(course["c"].iloc[0]),
            "classement": [{"num": int(r.num), "nom": r.nom, "p_gagnant": round(float(r.p_v2), 3),
                            "p_place": round(float(r.pp_v2), 3), "cote": r.cote if pd.notna(r.cote) else None}
                           for r in tri.itertuples()],
            "conseils": conseils,
        })
    return out


def main():
    t0 = time.time()
    p, rap = charger()
    print(f"{len(p)} partants charges.")
    p = preparer(p)
    chemin = os.path.join(SORTIE, "hippique_v2.json")
    banc = None
    if "--banc-si-ancien" in sys.argv and os.path.exists(chemin):
        ancien = json.load(open(chemin, encoding="utf-8"))
        fait = ancien.get("banc_fait_le")
        if fait and (dt.datetime.now() - dt.datetime.fromisoformat(fait)).total_seconds() < 20 * 3600:
            banc = ancien["banc_essai"]
            print("Banc d'essai de moins de 20 h : on le garde.")
    banc_fait_le = None
    if banc is None:
        banc = banc_essai(p, rap)
        banc_fait_le = dt.datetime.now().isoformat(timespec="seconds")
    elif os.path.exists(chemin):
        banc_fait_le = json.load(open(chemin, encoding="utf-8")).get("banc_fait_le")
    print(json.dumps({k: v for k, v in banc.items() if k != "strategies"}, ensure_ascii=False))
    for k, v in banc["strategies"].items():
        print(f"  {k:12} paris {v['paris']:5}  reussite {v['reussite']}  rentabilite {v['roi']}  mois+ {v['mois_positifs']}/{v['mois']}  {'VALIDEE' if v['validee'] else ''}")
    prono = pronostics(p, banc)
    os.makedirs(SORTIE, exist_ok=True)
    with open(os.path.join(SORTIE, "hippique_v2.json"), "w", encoding="utf-8") as f:
        json.dump({"maj": dt.datetime.now(yanis.PARIS).strftime("%d/%m/%Y %H:%M"), "banc_fait_le": banc_fait_le,
                   "banc_essai": banc, "courses": prono},
                  f, ensure_ascii=False, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(f"{len(prono)} courses pronostiquees. Termine en {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
