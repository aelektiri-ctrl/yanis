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
               c.arrivee, c.depart, c.corde AS sens, c.terrain, c.categorie, c.paris AS paris_offerts, r.hippodrome_code, r.pays
        FROM partants p JOIN courses c USING (date, r, c) JOIN reunions r USING (date, r)
        WHERE p.statut = 'PARTANT'""", con)
    rap = pd.read_sql_query("SELECT date, r, c, pari, libelle, combinaison, rapport_pour_1e FROM rapports", con)
    p = p.merge(charger_perfs(), on=["date", "r", "c", "num"], how="left")
    return p, rap


def charger_perfs():
    """Resumes des performances detaillees (dernieres courses de chaque cheval, connues avant la course)."""
    import glob, gzip
    lignes = []
    for f in glob.glob(os.path.join(yanis.DOSSIER, "donnees_perf_resume", "*", "*", "*.json.gz")):
        date = os.path.basename(f)[:10]
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            d = json.load(fh)
        for cle, chevaux in d.items():
            r, c = cle[1:].split("C")
            for num, v in chevaux.items():
                lignes.append({"date": date, "r": int(r), "c": int(c), "num": int(num), **{f"pf_{k}": x for k, x in v.items()}})
    cols = ["date", "r", "c", "num"]
    return pd.DataFrame(lignes) if lignes else pd.DataFrame(columns=cols)


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


LETTRE_DISC = {"ATTELE": "a", "MONTE": "m", "PLAT": "p", "HAIE": "h", "STEEPLECHASE": "s", "CROSS": "c"}


def musique_detaillee(m):
    """[(place, lettre de discipline)] pour les courses de la musique, de la plus recente a la plus ancienne."""
    if not isinstance(m, str) or not m:
        return []
    m = re.sub(r"\(\d+\)", "", m)
    return [(int(c) if c.isdigit() and c != "0" else 0, d.lower()) for c, d in re.findall(r"([0-9DATRS])([a-zA-Z])", m)]


def indices_musique(m, disc):
    """Forme dans la discipline du jour, forme dans les AUTRES disciplines, et signe de sous-performance recente."""
    md = musique_detaillee(m)
    lettre = LETTRE_DISC.get(disc, "?")
    val = lambda x: x if x else 10
    meme = [val(pl) for pl, d in md if d == lettre]
    autre = [val(pl) for pl, d in md if d != lettre]
    recentes = [val(pl) for pl, _ in md[:3]]
    anciennes = [val(pl) for pl, _ in md[3:10]]
    return {
        "mus_meme_n": len(meme), "mus_meme_moy": np.mean(meme) if meme else np.nan, "mus_meme_best": min(meme) if meme else np.nan,
        "mus_autre_n": len(autre), "mus_autre_moy": np.mean(autre) if autre else np.nan, "mus_autre_best": min(autre) if autre else np.nan,
        "chg_discipline": float(md[0][1] != lettre) if md else np.nan,
        # « tour » : de bons resultats avant, de mauvais recemment (le cheval a pu etre cache)
        "sous_perf": (np.mean(recentes) - min(anciennes)) if recentes and anciennes else np.nan,
    }


def preparer(p):
    p = p.copy()
    p["jour"] = pd.to_datetime(p["date"])
    p["cle"] = p["date"] + "/" + p["r"].astype(str) + "/" + p["c"].astype(str)
    p["driver_n"] = p["driver"].map(norm_nom)
    p["entraineur_n"] = p["entraineur"].map(norm_nom)
    p["gagne"] = (p["place_arrivee"] == 1).astype(int)
    p["fini"] = p["arrivee"].notna()
    p["nb_partants"] = p.groupby("cle")["num"].transform("count")   # seulement les vrais partants
    p["places_payees"] = np.where(p["nb_partants"] <= 7, 2, 3)     # 7 partants ou moins : 2 places
    p["place3"] = (p["place_arrivee"].between(1, 3) & (p["place_arrivee"] <= p["places_payees"])).astype(int)
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
    im = pd.DataFrame([indices_musique(m, d) for m, d in zip(p["musique"], p["discipline"])], index=p.index)
    p = pd.concat([p, im], axis=1)

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
    # --- changements suspects ---
    p["chg_entraineur"] = (g["entraineur_n"].shift(1) != p["entraineur_n"]).astype(float).where(prev_ts.notna())
    p["retour_pause"] = (p["repos_j"] >= 60).astype(float).where(p["repos_j"].notna())
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

    # driver qui monte en gamme par rapport a la derniere course du cheval
    p["dr_tx_prec"] = p.groupby("nom", sort=False)["dr_tx_v"].shift(1)
    p["montee_driver"] = p["dr_tx_v"] - p["dr_tx_prec"]
    # rang du cheval dans sa course sur quelques indices cles
    for col in ("vit_max5", "vit_moy3"):
        p[f"rg_{col}"] = p.groupby("cle")[col].rank(pct=True)
        p[f"ecart_{col}"] = p[col] - p.groupby("cle")[col].transform("max")
    for col in ("gains_par_course", "dr_tx_v", "en_tx_v", "mus_moy"):
        p[f"rg_{col}"] = p.groupby("cle")[col].rank(pct=True)

    # --- terrain, specialistes, categorie, calendrier ---
    p["etranger"] = (p["pays"].fillna("FRA") != "FRA").astype(int)
    terr = p["terrain"].fillna("").str.upper()
    p["terrain_c"] = np.select([terr.str.contains("TRES LOURD|TRÈS LOURD"), terr.str.contains("LOURD"), terr.str.contains("COLLANT"),
                                terr.str.contains("SOUPLE"), terr.str.contains("BON"), terr.str.contains("SEC|LEGER|LÉGER|RAPIDE")],
                               [5, 4, 3, 2, 1, 0], default=-1)
    p["jour_mois"] = p["jour"].dt.day
    g = p.groupby("nom", sort=False)
    p["alloc_prec"] = g["allocation"].shift(1)
    p["alloc_ratio"] = np.log((p["allocation"] + 1) / (p["alloc_prec"] + 1))  # >0 : monte de categorie
    for col, cle in (("dr_hippo", ["driver_n", "hippodrome_code"]), ("en_hippo", ["entraineur_n", "hippodrome_code"]),
                     ("ch_hippo", ["nom", "hippodrome_code"]), ("ch_terrain", ["nom", "terrain_c"])):
        gg = p.groupby(cle, sort=False)
        p[f"{col}_courses"] = gg.cumcount()
        p[f"{col}_tx_v"] = ((gg["gagne"].cumsum() - p["gagne"]) + 1.5) / (p[f"{col}_courses"] + 15)
        p[f"{col}_tx_p"] = ((gg["place3"].cumsum() - p["place3"]) + 4.5) / (p[f"{col}_courses"] + 15)

    # --- performances detaillees : niveau relatif de la course du jour ---
    if "pf_alloc_moy" in p.columns:
        p["pf_niveau"] = np.log((p["allocation"] + 1) / (p["pf_alloc_moy"].astype(float) + 1))
        for col in ("pf_retard_km_moy", "pf_long_moy", "pf_place_moy"):
            p[f"rg_{col}"] = p.groupby("cle")[col].rank(pct=True, ascending=False)
    p["groupe"] = np.select([p["discipline"] == "ATTELE", p["discipline"] == "MONTE", p["discipline"] == "PLAT"],
                            ["Trot attelé", "Trot monté", "Plat"], default="Obstacle")
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
    "etranger", "terrain_c", "jour_mois", "alloc_ratio",
    "mus_meme_n", "mus_meme_moy", "mus_meme_best", "mus_autre_n", "mus_autre_moy", "mus_autre_best", "chg_discipline", "sous_perf",
    "chg_entraineur", "retour_pause", "montee_driver",
    "pf_n", "pf_place_moy", "pf_top3", "pf_vict", "pf_dq", "pf_retard_km_moy", "pf_retard_km_min", "pf_long_moy", "pf_long_min",
    "pf_alloc_moy", "pf_alloc_max", "pf_jours", "pf_niveau", "rg_pf_retard_km_moy", "rg_pf_long_moy", "rg_pf_place_moy",
    "dr_hippo_courses", "dr_hippo_tx_v", "en_hippo_tx_v", "ch_hippo_courses", "ch_hippo_tx_p", "ch_terrain_courses", "ch_terrain_tx_p",
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
        if pari.endswith("_ORDRE"):
            if [int(v) for v in re.findall(r"\d+", comb or "")] == [int(v) for v in chevaux]:
                return rap
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
    "deux_sur_4_fav": "2 sur 4 : favori du marché + meilleur cheval Yanis (hors favori)",
    "pepite_sg": "Pépite du jour en simple gagnant",
    "pepite_sp": "Pépite du jour en simple placé",
    "co_top2": "Couplé ordre avec les 2 premiers Yanis (7 partants ou moins)",
    "to_top3": "Trio ordre avec les 3 premiers Yanis (7 partants ou moins)",
}


def jouer(course, idx):
    """Paris de chaque strategie pour une course : liste (strategie, mise, retour)."""
    cle = course["cle"].iloc[0]
    tri = course.sort_values("p_v2", ascending=False)
    nums = tri["num"].tolist()
    n = len(nums)
    out = []
    top = tri.iloc[0]
    cote_top = top["cote"]
    out.append(("sg_top", 1, gain(idx, cle, "SIMPLE_GAGNANT", [nums[0]]), cote_top))
    for row in tri.itertuples():
        if row.cote and row.p_v2 * row.cote >= 1.10 and row.p_v2 >= 0.08:
            out.append(("sg_value", 1, gain(idx, cle, "SIMPLE_GAGNANT", [row.num]), row.cote))
    if n >= 4:
        out.append(("sp_top", 1, gain(idx, cle, "SIMPLE_PLACE", [nums[0]]), cote_top))
        for row in tri.itertuples():
            if row.pp_v2 >= 0.45 and row.pp_v2 >= 1.25 * (row.p_marche_place or 0):
                out.append(("sp_value", 1, gain(idx, cle, "SIMPLE_PLACE", [row.num]), row.cote))
    if n <= 7:
        # petite course : couple et trio dans l'ordre exact
        if n >= 3:
            out.append(("co_top2", 1, gain(idx, cle, "COUPLE_ORDRE", nums[:2]), None))
            out.append(("to_top3", 1, gain(idx, cle, "TRIO_ORDRE", nums[:3]), None))
        return out
    fav = int(course.loc[course["cote"].idxmin(), "num"]) if course["cote"].notna().any() else None
    if fav is not None:
        autre = next(x for x in nums if x != fav)
        out.append(("deux_sur_4_fav", 1, gain(idx, cle, "DEUX_SUR_QUATRE", [fav, autre]), None))
    out.append(("cp_top2", 1, gain(idx, cle, "COUPLE_PLACE", nums[:2]), None))
    out.append(("deux_sur_4", 1, gain(idx, cle, "DEUX_SUR_QUATRE", nums[:2]), None))
    out.append(("trio_top3", 1, gain(idx, cle, "TRIO", nums[:3]), None))
    out.append(("multi4_top4", 1, gain(idx, cle, "MULTI", nums[:4], "Multi en 4"), None))
    return out


PEPITE_COTE_MIN = 8


def choisir_pepite(jour_df, combien=1):
    """L'outsider (cote >= 8, course en France) que Yanis juge le plus sous-estime de la journee."""
    o = jour_df[(jour_df["cote"] >= PEPITE_COTE_MIN) & (jour_df["p_v2"] >= 0.06) & jour_df["p_marche"].notna()
                & (jour_df["etranger"] == 0)]
    if o.empty:
        return None if combien == 1 else []
    o = o.assign(ratio=o["p_v2"] / o["p_marche"]).sort_values("ratio", ascending=False)
    return o.iloc[0] if combien == 1 else [row for _, row in o.head(combien).iterrows()]


def tranche_cote(c):
    if c is None or not np.isfinite(c):
        return None
    for borne, nom in ((2, "moins de 2"), (3, "2 à 3"), (5, "3 à 5"), (10, "5 à 10"), (20, "10 à 20")):
        if c < borne:
            return nom
    return "20 et plus"


def segments_course(course):
    alloc = course["allocation"].iloc[0] or 0
    j = int(course["jour_mois"].iloc[0])
    return {
        "Taille de la course": "petite (moins de 15 000 €)" if alloc < 15000 else "moyenne (15 000 à 40 000 €)" if alloc < 40000 else "grosse (plus de 40 000 €)",
        "Pays": "étranger" if course["etranger"].iloc[0] else "France",
        "Discipline": course["groupe"].iloc[0],
        "Période du mois": "début (1 au 10)" if j <= 10 else "milieu (11 au 20)" if j <= 20 else "fin (21 au 31)",
    }


def compte(dico, cle, mise, retour, mois):
    x = dico.setdefault(cle, {"paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0, "par_mois": {}})
    x["paris"] += 1; x["gagnes"] += int(retour > 0); x["mise"] += mise; x["retour"] += retour
    pm = x["par_mois"].setdefault(mois, [0, 0.0, 0.0])
    pm[0] += 1; pm[1] += mise; pm[2] += retour


def resume(x, strict=False):
    roi = (x["retour"] - x["mise"]) / x["mise"] if x["mise"] else None
    mois_pos = sum(1 for v in x["par_mois"].values() if v[2] > v[1])
    nb_mois = len(x["par_mois"])
    if strict:   # un segment doit prouver davantage (on en teste beaucoup : risque de chance)
        bon = roi is not None and roi > 0.05 and x["paris"] >= 300 and nb_mois >= 3 and mois_pos >= 0.75 * nb_mois
        ok, prometteur = bon and nb_mois >= 6, bon and nb_mois < 6
    else:
        ok = roi is not None and roi > 0.02 and x["paris"] >= 150 and mois_pos >= max(2, nb_mois - 1)
        prometteur = False
    return {"paris": x["paris"], "reussite": round(x["gagnes"] / x["paris"], 3) if x["paris"] else None,
            "roi": round(roi, 4) if roi is not None else None, "mois_positifs": mois_pos, "mois": nb_mois,
            "validee": bool(ok), "prometteur": bool(prometteur)}


# --------------------------------------------------------------------------
# 3. Banc d'essai mois par mois
# --------------------------------------------------------------------------

def colonnes_utiles(df):
    """Les indices qui existent vraiment pour ce groupe (pas de temps en obstacle, par exemple)."""
    return [v for v in VARIABLES if v in df.columns and df[v].notna().sum() >= 50 and df[v].nunique() > 1]


def entrainer_et_predire(train, test, mini_groupe=8000):
    """Un modele par discipline (trot attele, monte, plat, obstacle) si assez de donnees, sinon un modele commun."""
    train = train.replace([np.inf, -np.inf], np.nan)
    test = test.replace([np.inf, -np.inf], np.nan).copy()
    test["s_v"], test["s_p"] = np.nan, np.nan
    commun = None
    for grp in test["groupe"].unique():
        tr = train[train["groupe"] == grp]
        if len(tr) < mini_groupe:
            if commun is None:
                cols_c = colonnes_utiles(train)
                commun = (cols_c, modele("v").fit(train[cols_c], train["gagne"]), modele("p").fit(train[cols_c], train["place3"]))
            cols, mv, mp = commun
        else:
            cols = colonnes_utiles(tr)
            mv, mp = modele("v").fit(tr[cols], tr["gagne"]), modele("p").fit(tr[cols], tr["place3"])
        m = test["groupe"] == grp
        test.loc[m, "s_v"] = mv.predict_proba(test.loc[m, cols])[:, 1]
        test.loc[m, "s_p"] = mp.predict_proba(test.loc[m, cols])[:, 1]
    test["p_v2"] = probas_course(test, "s_v")
    k = np.minimum(test["places_payees"], test.groupby("cle")["num"].transform("count"))
    test["pp_v2"] = (test["s_p"] / test.groupby("cle")["s_p"].transform("sum") * k).clip(upper=0.98)
    return test


def banc_essai(p, rap):
    idx = index_rapports(rap)
    finis = p[p["fini"]].copy()
    finis["mois"] = finis["date"].str[:7]
    mois = sorted(finis["mois"].unique())
    # proba "placee" implicite du marche (approximation) pour la strategie sp_value
    res = {k: {"paris": 0, "gagnes": 0, "mise": 0.0, "retour": 0.0, "par_mois": {}} for k in STRATEGIES}
    segments_res = {}
    stats_modele = {"courses": 0, "n1_gagne": 0, "fav_gagne": 0, "logloss_modele": 0.0, "logloss_marche": 0.0}
    for i, m in enumerate(mois):
        if i < max(MOIS_MINI_ENTRAINEMENT, len(mois) - MOIS_TESTES):
            continue
        train = finis[(finis["mois"] < m) & (finis["mois"] >= mois[max(0, i - FENETRE_MOIS)])]
        test = finis[finis["mois"] == m]
        if len(test) < 200:
            continue
        test = entrainer_et_predire(train, test)
        test["p_marche_place"] = (test["p_marche"] * (test["places_payees"] - 0.4)).clip(upper=0.95)
        for date_j, jdf in test.groupby("date"):
            pep = choisir_pepite(jdf[jdf["fini"]])
            if pep is None:
                continue
            for strat, pari in (("pepite_sg", "SIMPLE_GAGNANT"), ("pepite_sp", "SIMPLE_PLACE")):
                ret = gain(idx, pep["cle"], pari, [int(pep["num"])])
                r = res[strat]
                r["paris"] += 1; r["gagnes"] += int(ret > 0); r["mise"] += 1; r["retour"] += ret
                pm = r["par_mois"].setdefault(m, [0, 0.0, 0.0])
                pm[0] += 1; pm[1] += 1; pm[2] += ret
        for cle, course in test.groupby("cle", sort=False):
            if course["gagne"].sum() != 1 or course["p_marche"].isna().any():
                continue
            stats_modele["courses"] += 1
            stats_modele["n1_gagne"] += int(course.loc[course["p_v2"].idxmax(), "gagne"])
            stats_modele["fav_gagne"] += int(course.loc[course["p_marche"].idxmax(), "gagne"])
            g = course[course["gagne"] == 1].iloc[0]
            stats_modele["logloss_modele"] -= math.log(max(g["p_v2"], 1e-4))
            stats_modele["logloss_marche"] -= math.log(max(g["p_marche"], 1e-4))
            segs = segments_course(course)
            for strat, mise, retour, cote_jouee in jouer(course, idx):
                r = res[strat]
                r["paris"] += 1; r["gagnes"] += int(retour > 0); r["mise"] += mise; r["retour"] += retour
                pm = r["par_mois"].setdefault(m, [0, 0.0, 0.0])
                pm[0] += 1; pm[1] += mise; pm[2] += retour
                sg = segments_res.setdefault(strat, {})
                for famille, valeur in segs.items():
                    compte(sg.setdefault(famille, {}), valeur, mise, retour, m)
                tc = tranche_cote(cote_jouee)
                if tc:
                    compte(sg.setdefault("Cote du cheval joué", {}), tc, mise, retour, m)
    n = stats_modele["courses"]
    fav_rows = finis[finis["cote"].notna()]
    fav_rows = fav_rows.loc[fav_rows.groupby("cle")["cote"].idxmin()]
    favori_topk = {str(k): round(float(fav_rows["place_arrivee"].between(1, k).mean()), 3) for k in (1, 2, 3, 4)}
    sortie = {
        "favori_dans_les": favori_topk,
        "mois_testes": [m for i, m in enumerate(mois) if i >= max(MOIS_MINI_ENTRAINEMENT, len(mois) - MOIS_TESTES)],
        "courses": n,
        "n1_yanis_gagne": round(stats_modele["n1_gagne"] / n, 3) if n else None,
        "favori_gagne": round(stats_modele["fav_gagne"] / n, 3) if n else None,
        "precision_vs_marche": round((stats_modele["logloss_marche"] - stats_modele["logloss_modele"]) / n, 4) if n else None,
        "strategies": {},
    }
    for k, r in res.items():
        sortie["strategies"][k] = {"nom": STRATEGIES[k], **resume(r)}
    sortie["segments"] = {k: {fam: {val: resume(x, strict=True) for val, x in vals.items()} for fam, vals in fams.items()}
                          for k, fams in segments_res.items()}
    sortie["segments_valides"] = [{"strategie": k, "famille": fam, "valeur": val, **v}
                                  for k, fams in sortie["segments"].items() for fam, vals in fams.items()
                                  for val, v in vals.items() if v["validee"] or v["prometteur"]]
    return sortie


# --------------------------------------------------------------------------
# 3 bis. Analyses du marche seul : biais favori/outsider et theorie du calendrier
# --------------------------------------------------------------------------

def analyses_marche(p, rap):
    """Sur toutes les courses de la bibliotheque : que rapporte le fait de jouer chaque cheval
    d'une tranche de cote donnee (gagnant et place), et le favori selon la periode du mois ?"""
    idx = index_rapports(rap)
    f = p[p["fini"] & p["cote"].notna()].copy()
    f["mois"] = f["date"].str[:7]
    f["tranche"] = f["cote"].map(tranche_cote)
    f["periode"] = np.where(f["jour_mois"] <= 10, "début (1 au 10)", np.where(f["jour_mois"] <= 20, "milieu (11 au 20)", "fin (21 au 31)"))
    tranches, calendrier = {}, {}
    for cle, course in f.groupby("cle", sort=False):
        if course["gagne"].sum() != 1:
            continue
        n = len(course)
        mois = course["mois"].iloc[0]
        fav = course.loc[course["cote"].idxmin()]
        for row in course.itertuples():
            compte(tranches.setdefault("Simple gagnant", {}), row.tranche, 1, gain(idx, cle, "SIMPLE_GAGNANT", [row.num]), mois)
            if n >= 4:
                compte(tranches.setdefault("Simple placé", {}), row.tranche, 1, gain(idx, cle, "SIMPLE_PLACE", [row.num]), mois)
        compte(calendrier.setdefault("Favori simple gagnant", {}), fav["periode"], 1, gain(idx, cle, "SIMPLE_GAGNANT", [fav["num"]]), mois)
        if n >= 4:
            compte(calendrier.setdefault("Favori simple placé", {}), fav["periode"], 1, gain(idx, cle, "SIMPLE_PLACE", [fav["num"]]), mois)
    ordre = ["moins de 2", "2 à 3", "3 à 5", "5 à 10", "10 à 20", "20 et plus"]
    return {
        "tranches_de_cote": {k: {t: resume(v[t], strict=True) for t in ordre if t in v} for k, v in tranches.items()},
        "calendrier": {k: {t: resume(v[t], strict=True) for t in ("début (1 au 10)", "milieu (11 au 20)", "fin (21 au 31)") if t in v}
                       for k, v in calendrier.items()},
    }


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
        n = len(nums)
        offerts = course["paris_offerts"].iloc[0]
        offerts = set(offerts.split(",")) if isinstance(offerts, str) and offerts else None
        def existe(code):
            return offerts is None or code in offerts or f"E_{code}" in offerts
        possibles = []
        if n >= 4:
            possibles.append(("SIMPLE_PLACE", {"strategie": "sp_top", "chevaux": nums[:1], "texte": f"Simple placé n°{nums[0]}"}))
        if 3 <= n <= 7:
            possibles += [("COUPLE_ORDRE", {"strategie": "co_top2", "chevaux": nums[:2], "texte": f"Couplé ordre {nums[0]}-{nums[1]} (dans cet ordre)"}),
                          ("TRIO_ORDRE", {"strategie": "to_top3", "chevaux": nums[:3], "texte": f"Trio ordre {nums[0]}-{nums[1]}-{nums[2]} (dans cet ordre)"})]
        fav = int(course.loc[course["cote"].idxmin(), "num"]) if course["cote"].notna().any() else None
        if n >= 8 and fav is not None:
            autre = next(x for x in nums if x != fav)
            possibles.append(("DEUX_SUR_QUATRE", {"strategie": "deux_sur_4_fav", "chevaux": [fav, autre], "texte": f"2 sur 4 favori {fav} + Yanis {autre}"}))
        if n >= 8:
            possibles += [("COUPLE_PLACE", {"strategie": "cp_top2", "chevaux": nums[:2], "texte": f"Couplé placé {nums[0]}-{nums[1]}"}),
                          ("DEUX_SUR_QUATRE", {"strategie": "deux_sur_4", "chevaux": nums[:2], "texte": f"2 sur 4 {nums[0]}-{nums[1]}"}),
                          ("MULTI", {"strategie": "multi4_top4", "chevaux": nums[:4], "texte": "Multi en 4 " + "-".join(map(str, nums[:4]))})]
        conseils = [c for c in conseils if existe("SIMPLE_GAGNANT")] + [c for code, c in possibles if existe(code)]
        segs = segments_course(course)
        cotes_par_num = dict(zip(course["num"], course["cote"]))
        for cns in conseils:
            raison, segment_ok = None, False
            if cns["strategie"] in validees:
                raison = "formule rentable sur le banc d'essai"
            else:
                for sv in banc.get("segments_valides", []):
                    if sv["strategie"] != cns["strategie"]:
                        continue
                    if sv["famille"] == "Cote du cheval joué":
                        c0 = cotes_par_num.get(cns["chevaux"][0])
                        if c0 is not None and tranche_cote(c0) == sv["valeur"]:
                            raison = f"rentable quand la cote est {sv['valeur']}"
                    elif segs.get(sv["famille"]) == sv["valeur"]:
                        raison = f"rentable sur ce type de course ({sv['famille'].lower()} : {sv['valeur']})"
                    if raison:
                        segment_ok = sv.get("validee", False)
                        break
            cns["validee"] = raison is not None and (cns["strategie"] in validees or segment_ok)
            cns["prometteur"] = raison is not None and not cns["validee"]
            cns["raison"] = raison
            cns["chevaux"] = [int(x) for x in cns["chevaux"]]
            if cns["strategie"] == "sg_value":
                row = course[course["num"] == cns["chevaux"][0]].iloc[0]
                cns["proba"], cns["cote"] = round(float(row["p_v2"]), 3), float(row["cote"]) if pd.notna(row["cote"]) else None
        out.append({
            "date": course["date"].iloc[0], "r": int(course["r"].iloc[0]), "c": int(course["c"].iloc[0]),
            "partants": n, "places_payees": 2 if n <= 7 else 3, "favori": fav,
            **dict(zip(("menu", "desordre", "outsiders"), menu_formules(course, offerts))),
            "classement": [{"num": int(r.num), "nom": r.nom, "p_gagnant": round(float(r.p_v2), 3),
                            "p_place": round(float(r.pp_v2), 3), "cote": r.cote if pd.notna(r.cote) else None}
                           for r in tri.itertuples()],
            "conseils": conseils,
        })
    return out


NOMS_DISC = {"a": "trot attelé", "m": "trot monté", "p": "plat", "h": "haies", "s": "steeple", "c": "cross"}


LAMBDA_PLACES = 0.6   # regle sur les vraies arrivees : derriere le gagnant, les outsiders viennent plus souvent qu'on croit


def simuler_arrivees(probas, n_sim=20000, graine=0):
    """Tire 20 000 arrivees possibles a partir des chances de victoire.
    Le 1er est tire avec les chances de victoire ; les 2e, 3e et 4e avec des chances « aplaties »
    (reglage verifie sur l'historique : favori dans les 4 prevu 72 % / reel 70 %, outsiders 15+ prevu 18 % / reel 18 %).
    Renvoie un tableau (n_sim x nb chevaux) : place de chaque cheval (5 = au-dela de la 4e)."""
    rng = np.random.default_rng(graine)
    lp = np.log(np.clip(np.asarray(probas, float), 1e-6, None))
    n = len(lp)
    places = np.full((n_sim, n), 5, dtype=int)
    dispo = np.ones((n_sim, n), dtype=bool)
    for etape in range(min(4, n)):
        w = (lp if etape == 0 else lp * LAMBDA_PLACES) + rng.gumbel(size=(n_sim, n))
        w[~dispo] = -np.inf
        choix = w.argmax(axis=1)
        places[np.arange(n_sim), choix] = etape + 1
        dispo[np.arange(n_sim), choix] = False
    return places


def raisons_outsider(r):
    """Pourquoi ce cheval peut creer la surprise (en francais simple)."""
    out = []
    if r.get("chg_discipline") == 1 and pd.notna(r.get("mus_autre_best")) and r["mus_autre_best"] <= 3:
        lettre = next((d for _, d in musique_detaillee(r.get("musique")) if d != LETTRE_DISC.get(r.get("discipline"))), "?")
        out.append(f"vient du {NOMS_DISC.get(lettre, 'autre discipline')} où il a déjà fini {int(r['mus_autre_best'])}e")
    if pd.notna(r.get("sous_perf")) and r["sous_perf"] >= 4:
        out.append("ses dernières courses sont bien en dessous de son niveau habituel (possible « tour »)")
    if r.get("d4_nouveau") == 1:
        out.append("déferré des 4 pieds pour la première fois")
    if pd.notna(r.get("montee_driver")) and r["montee_driver"] >= 0.04:
        out.append("meilleur driver/jockey qu'à sa dernière course")
    if r.get("chg_entraineur") == 1:
        out.append("nouvel entraîneur")
    if pd.notna(r.get("alloc_ratio")) and r["alloc_ratio"] <= -0.3:
        out.append("descend de catégorie")
    if pd.notna(r.get("derive_cote")) and r["derive_cote"] >= 0.25:
        out.append("sa cote a fondu depuis le matin : de l'argent arrive sur lui")
    if r.get("retour_pause") == 1 and r.get("meme_hippo") == 1:
        out.append("revient de repos sur un hippodrome qu'il connaît")
    if pd.notna(r.get("pf_long_min")) and r["pf_long_min"] <= 1.5 and r.get("cote", 0) >= 12:
        out.append("a déjà fini à moins de 2 longueurs du gagnant récemment")
    return out


def menu_formules(course, offerts):
    """Pour une course : chaque formule possible avec ses chances de passer (simulation) et son nombre de combinaisons."""
    tri = course.sort_values("p_v2", ascending=False).reset_index(drop=True)
    nums = [int(x) for x in tri["num"]]
    n = len(nums)
    if n < 3:
        return [], None, []
    places = simuler_arrivees(tri["p_v2"].values)
    pos = {num: places[:, i] for i, num in enumerate(nums)}
    nb_places = 2 if n <= 7 else 3
    existe = lambda code: offerts is None or code in offerts or f"E_{code}" in offerts
    dans = lambda chevaux, k: np.all(np.stack([pos[c] <= k for c in chevaux]), axis=0).mean()
    menu = []
    def ajoute(code, texte, chevaux, proba, combis):
        if existe(code):
            menu.append({"texte": texte, "chevaux": chevaux, "chances": round(float(proba), 3), "combinaisons": combis, "code": code})
    a, b, c = nums[0], nums[1], nums[2]
    ajoute("SIMPLE_GAGNANT", f"Simple gagnant n°{a}", [a], (pos[a] == 1).mean(), 1)
    if n >= 4:
        ajoute("SIMPLE_PLACE", f"Simple placé n°{a}", [a], (pos[a] <= nb_places).mean(), 1)
    # le loup : l'outsider le plus capable de finir dans les 4
    cotes = dict(zip(tri["num"].astype(int), tri["cote"]))
    candidats = [x for x in nums[3:] if (cotes.get(x) or 0) >= 12]
    p4 = {x: (pos[x] <= 4).mean() for x in nums}
    loups = sorted(candidats, key=lambda x: -p4[x])[:2]
    if n <= 7:
        ajoute("COUPLE_ORDRE", f"Couplé ordre {a}-{b}", [a, b], ((pos[a] == 1) & (pos[b] == 2)).mean(), 1)
        ajoute("COUPLE_ORDRE", f"Couplé ordre {a}-{b} et {b}-{a} (2 sens)", [a, b], dans([a, b], 2), 2)
        ajoute("TRIO_ORDRE", f"Trio ordre {a}-{b}-{c}", [a, b, c], ((pos[a] == 1) & (pos[b] == 2) & (pos[c] == 3)).mean(), 1)
        ajoute("TRIO_ORDRE", f"Trio ordre {a}-{b}-{c} dans tous les ordres", [a, b, c], dans([a, b, c], 3), 6)
    else:
        ajoute("COUPLE_PLACE", f"Couplé placé {a}-{b}", [a, b], dans([a, b], 3), 1)
        ajoute("DEUX_SUR_QUATRE", f"2 sur 4 {a}-{b}", [a, b], dans([a, b], 4), 1)
        ajoute("TRIO", f"Trio {a}-{b}-{c}", [a, b, c], dans([a, b, c], 3), 1)
        if n >= 6:
            ass = nums[2:6]
            ok = (pos[a] <= 3) & (pos[b] <= 3) & np.any(np.stack([pos[x] <= 3 for x in ass]), axis=0)
            ajoute("TRIO", f"Trio champ réduit : bases {a}-{b} + {'-'.join(map(str, ass))}", [a, b] + ass, ok.mean(), len(ass))
        code_multi = "MULTI" if existe("MULTI") else "MINI_MULTI"
        nom_multi = "Multi" if code_multi == "MULTI" else "Mini multi"
        for k in (4, 5, 6):
            if n > k:
                ajoute(code_multi, f"{nom_multi} en {k} : {'-'.join(map(str, nums[:k]))}", nums[:k],
                       np.sum(np.stack([places[:, i] <= 4 for i in range(k)]), axis=0).__ge__(min(4, n)).mean(), {4: 1, 5: 5, 6: 15}[k])
        if loups:
            l = loups[0]
            ajoute("DEUX_SUR_QUATRE", f"2 sur 4 avec le loup : {a}-{l}", [a, l], dans([a, l], 4), 1)
    # indice de desordre : un cheval a 15 contre 1 ou plus dans les 4 premiers
    gros = [x for x in nums if (cotes.get(x) or 0) >= 15]
    desordre = 0.0
    if tri["cote"].notna().sum() < max(3, n / 2):
        desordre = None   # pas encore de cotes : on ne sait pas
    elif gros:
        # calcule avec les cotes du marche (c'est sur elles que le reglage a ete verifie)
        pm = tri["p_marche"].fillna(tri["p_v2"]).values
        pl_m = simuler_arrivees(pm, n_sim=10000, graine=1)
        idx_gros = [i for i, x in enumerate(nums) if x in gros]
        desordre = float((pl_m[:, idx_gros] <= 4).any(axis=1).mean())
    dangereux = []
    for x in loups:
        r = tri[tri["num"] == x].iloc[0].to_dict()
        dangereux.append({"num": x, "nom": r["nom"], "cote": cotes.get(x), "chances_4_premiers": round(float(p4[x]), 3),
                          "raisons": raisons_outsider(r) or ["Yanis le voit plus souvent dans les 4 que ce que dit sa cote"]})
    return menu, (round(desordre, 3) if desordre is not None else None), dangereux


def pepite_du_jour(p, banc):
    auj = yanis.aujourdhui().isoformat()
    debut = (yanis.aujourdhui() - dt.timedelta(days=30 * FENETRE_MOIS)).isoformat()
    train = p[p["fini"] & (p["date"] < auj) & (p["date"] >= debut)]
    test = p[(p["date"] == auj) & ~p["fini"]]
    if test.empty or len(train) < 5000:
        return None
    test = entrainer_et_predire(train, test)
    return [{"date": auj, "r": int(pep["r"]), "c": int(pep["c"]), "num": int(pep["num"]), "nom": pep["nom"],
             "hippodrome": pep["hippodrome_code"], "cote": float(pep["cote"]), "p_gagnant": round(float(pep["p_v2"]), 3),
             "p_place": round(float(pep["pp_v2"]), 3), "p_marche": round(float(pep["p_marche"]), 3), "depart": pep["depart"],
             "texte": f"Yanis le voit gagnant {round(100 * float(pep['p_v2']))} % du temps, le marché seulement {round(100 * float(pep['p_marche']))} %."}
            for pep in choisir_pepite(test, combien=3)]


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
        banc["marche"] = analyses_marche(p, rap)
        banc_fait_le = dt.datetime.now().isoformat(timespec="seconds")
    elif os.path.exists(chemin):
        banc_fait_le = json.load(open(chemin, encoding="utf-8")).get("banc_fait_le")
    print(json.dumps({k: v for k, v in banc.items() if k not in ("strategies", "segments", "segments_valides", "marche")}, ensure_ascii=False))
    for k, v in banc["strategies"].items():
        print(f"  {k:12} paris {v['paris']:5}  reussite {v['reussite']}  rentabilite {v['roi']}  mois+ {v['mois_positifs']}/{v['mois']}  {'VALIDEE' if v['validee'] else ''}")
    print("Segments valides :", banc.get("segments_valides"))
    for k, v in banc.get("marche", {}).get("tranches_de_cote", {}).items():
        print(" ", k, {t: (x["paris"], x["roi"]) for t, x in v.items()})
    for k, v in banc.get("marche", {}).get("calendrier", {}).items():
        print(" ", k, {t: (x["paris"], x["reussite"], x["roi"]) for t, x in v.items()})
    prono = pronostics(p, banc)
    pepite = pepite_du_jour(p, banc)
    print("Pepite du jour :", pepite)
    os.makedirs(SORTIE, exist_ok=True)
    with open(os.path.join(SORTIE, "hippique_v2.json"), "w", encoding="utf-8") as f:
        json.dump({"maj": dt.datetime.now(yanis.PARIS).strftime("%d/%m/%Y %H:%M"), "banc_fait_le": banc_fait_le,
                   "banc_essai": banc, "courses": prono, "pepite": pepite},
                  f, ensure_ascii=False, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(f"{len(prono)} courses pronostiquees. Termine en {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
