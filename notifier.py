#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Notifications gratuites sur le telephone d'Abdel (application ntfy, sujet ci-dessous).
- un resume chaque matin apres 9 h
- une alerte 15 a 45 minutes avant chaque course ou Yanis a un pari VALIDE ou PROMETTEUR
On ne previent jamais deux fois pour la meme chose (memoire dans donnees_notifs.json).
"""
import datetime as dt
import json
import os
import urllib.request

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:
    PARIS = None

SUJET = "yanis-abdel-7k3q9x"
DOSSIER = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(DOSSIER, "docs", "data")
MEMOIRE = os.path.join(DOSSIER, "donnees_notifs.json")
APPLI = "https://aelektiri-ctrl.github.io/yanis/"


def envoyer(titre, texte, priorite="default", tags="horse"):
    req = urllib.request.Request(f"https://ntfy.sh/{SUJET}", data=texte.encode("utf-8"), method="POST",
                                 headers={"Title": titre.encode("utf-8"), "Priority": priorite, "Tags": tags, "Click": APPLI})
    try:
        urllib.request.urlopen(req, timeout=20).read()
        return True
    except Exception as e:
        print("notification non envoyee :", e)
        return False


def lire(nom):
    try:
        with open(os.path.join(DATA, nom), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main():
    maintenant = dt.datetime.now(PARIS)
    auj = maintenant.date().isoformat()
    memo = {}
    if os.path.exists(MEMOIRE):
        memo = json.load(open(MEMOIRE, encoding="utf-8"))
    memo = {k: v for k, v in memo.items() if v >= (maintenant.date() - dt.timedelta(days=3)).isoformat()}

    jour, v2 = lire("aujourdhui.json"), lire("hippique_v2.json")
    heures = {}
    if jour:
        for reu in jour["reunions"]:
            for c in reu["courses"]:
                if c.get("paris") == []:
                    continue   # course sans paris : inutile de prevenir
                heures[(reu["r"], c["c"])] = (c.get("depart"), reu.get("hippodrome"), c.get("arrivee"))

    # 1. alertes avant le depart
    for course in (v2 or {}).get("courses", []):
        if course["date"] != auj:
            continue
        depart, hippo, arrivee = heures.get((course["r"], course["c"]), (None, None, None))
        if not depart or arrivee:
            continue
        t = dt.datetime.fromisoformat(depart).replace(tzinfo=PARIS)
        minutes = (t - maintenant).total_seconds() / 60
        if not (5 <= minutes <= 45):
            continue
        for cns in course["conseils"]:
            if not (cns.get("validee") or cns.get("prometteur")):
                continue
            cle = f"{auj}/R{course['r']}C{course['c']}/{cns['texte']}"
            if cle in memo:
                continue
            statut = "VALIDÉ" if cns.get("validee") else "prometteur (à confirmer)"
            ok = envoyer(f"R{course['r']}C{course['c']} {hippo} – départ {depart[11:16]}",
                         f"{cns['texte']} · {statut}\n{cns.get('raison') or ''}\nDépart dans {int(minutes)} min.",
                         priorite="high" if cns.get("validee") else "default")
            if ok:
                memo[cle] = auj

    # 2. resume du matin
    cle_matin = f"{auj}/resume"
    if maintenant.hour >= 9 and cle_matin not in memo and jour:
        nb_courses = sum(len(r["courses"]) for r in jour["reunions"])
        val = sum(1 for c in (v2 or {}).get("courses", []) if c["date"] == auj for x in c["conseils"] if x.get("validee"))
        pro = sum(1 for c in (v2 or {}).get("courses", []) if c["date"] == auj for x in c["conseils"] if x.get("prometteur"))
        texte = (f"{len(jour['reunions'])} réunions, {nb_courses} courses analysées.\n"
                 f"Paris validés : {val} · prometteurs : {pro}.\n"
                 + ("Tu seras prévenu 15 à 45 min avant chaque départ concerné." if val + pro else "Rien ne mérite ta mise aujourd'hui : Yanis passe son tour."))
        if envoyer("Yanis – le programme du jour", texte, tags="sunrise"):
            memo[cle_matin] = auj

    with open(MEMOIRE, "w", encoding="utf-8") as f:
        json.dump(memo, f, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
