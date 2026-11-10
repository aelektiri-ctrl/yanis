"""Yanis – déroulé des courses (commentaires écrits Equidia).

Pour chaque course terminée, récupère la page Equidia de la course, en extrait les phrases qui
parlent de chaque cheval (« KONDOR (10) prend seul le meilleur en plaine… ») et classe son style :
  tete     : a mené / en tête / a fait le train            (le « lièvre » s'il ne rentre pas)
  contact  : bon rang / non loin des leaders / sillage     (l'« animateur »)
  arriere  : en retrait / queue de peloton / patient       (l'attentiste)
  finish   : bon effort final / a bien terminé / remonte   (le « magicien » s'il venait de l'arrière)
  cede     : a cédé / a faibli / a demandé à souffler
  faute    : faute / disqualifié / allure irrégulière

Fichiers : donnees_deroule/AAAA/MM/AAAA-MM-JJ.json.gz  →  {"R1C4": {"chevaux": {"10": {"texte": "...", "styles": [...]}}}}

Commandes :
  python deroule.py jour 2026-11-08
  python deroule.py collecte --budget 8      (hier + aujourd'hui, puis remonte l'historique tant qu'il reste du temps)
  python deroule.py test page.html           (lit une page enregistrée, pour vérifier l'extraction)
"""
import argparse, datetime as dt, gzip, html, json, os, re, sys, time, urllib.request
from html.parser import HTMLParser

DOSSIER = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(DOSSIER, "donnees_deroule")
URL = "https://www.equidia.fr/courses/{date}/R{r}/C{c}"
PAUSE = 1.5  # secondes entre deux pages : on reste discret

LEXIQUE = {
    "tete": r"en t[êe]te|a men[ée]|prend(?:s)? (?:seul )?le meilleur|pris le meilleur|au commandement|imprim\w+ (?:le|un) train|fait le train|dict\w+ (?:le|un) train|de bout en bout|en avant-garde|au leadership",
    "contact": r"animat\w+|bon rang|non loin|au contact|dans le sillage|aux avant-postes|jamais loin|en deuxi[èe]me (?:position|ligne)|en seconde (?:position|ligne)|[àa] l'ext[ée]rieur (?:du|des) (?:leader|animateur)|groupe de t[êe]te|bien plac[ée]|[ée]paule",
    "arriere": r"queue de peloton|en retrait|[àa] l'arri[èe]re|dernier groupe|seconde moiti[ée]|fin de peloton|en dernier|patient|attentiste|cach[ée]|en dedans",
    "finish": r"effort final|bien termin|fini (?:vite|fort|tr[èe]s vite)|bon finish|bonne fin de course|remont\w+|venu de l'arri[èe]re|progress\w+|est revenu|s'octroy\w+|arrach\w+|en trombe",
    "cede": r"c[ée]d[ée]|faibli|demand[ée] [àa] souffler|s'est [ée]teint|r[ée]trograd\w+|n'a pas suivi|rendu les armes|l[âa]ch[ée]|pli[ée]|sans r[ée]action|s'est arr[êe]t[ée] de",
    "faute": r"faut[ée]|\bfaute\b|disqualifi\w+|allure irr[ée]guli[èe]re|\bgalop[ée]?\b|rompu|\btomb[ée]",
}
LEX = {k: re.compile(v, re.I) for k, v in LEXIQUE.items()}
NOM_NUM = re.compile(r"([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9'’\-\. ]{1,40}?)\s*\((\d{1,2})\)")


class Texte(HTMLParser):
    """Texte visible + chaînes longues des scripts (pages rendues côté client)."""
    def __init__(self):
        super().__init__(); self.vis, self.scr, self.dans = [], [], None
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"): self.dans = tag
    def handle_endtag(self, tag):
        if tag == self.dans: self.dans = None
    def handle_data(self, d):
        if self.dans == "script": self.scr.append(d)
        elif self.dans is None and d.strip(): self.vis.append(d.strip())


def texte_page(page):
    p = Texte(); p.feed(page)
    morceaux = list(p.vis)
    for s in p.scr:  # chaînes JSON longues contenant « NOM (n) »
        for m in re.finditer(r'"((?:[^"\\]|\\.){40,})"', s):
            try: v = json.loads('"' + m.group(1) + '"')
            except Exception: continue
            if NOM_NUM.search(v): morceaux.append(re.sub(r"<[^>]+>", " ", v))
    return html.unescape(" \n".join(morceaux))


def styles(t):
    return [k for k, rx in LEX.items() if rx.search(t)]


OBJET = re.compile(r"(?:\bsur|\bdevant|\bderri[èe]re|\bdu|\bde|\bà|\bau|\bque|\bl['’]animateur|\ble leader|\bl['’]|\bpar)\s*$", re.I)
PRONOM = re.compile(r"^\s*(?:il|elle|lui|celui-ci|ce dernier|cette derni[èe]re|le cheval|la jument)\b", re.I)


def zone_analyse(t):
    """Le déroulé est dans « L'analyse » (après la course) : on ignore les pronostics d'avant-course."""
    m = re.search(r"L['’]analyse\b", t)
    return t[m.start(): m.start() + 6000] if m else t


def extraire(page, partants=None):
    """Renvoie (brut, {num: {"texte": ..., "styles": [...]}}) à partir d'une page de course."""
    t = texte_page(page)
    z = zone_analyse(t)
    noms = {int(p["num"]): (p.get("nom") or "").upper() for p in (partants or [])}
    out, dernier = {}, None
    for ph in re.split(r"(?<=[\.!?])\s+|\n", z):
        sujet = None
        for m in NOM_NUM.finditer(ph):
            n, nom = int(m.group(2)), m.group(1).strip().upper()
            if noms and n in noms and noms[n] and noms[n][:6] not in nom and nom[:6] not in noms[n]:
                continue
            if OBJET.search(ph[:m.start()][-25:]):   # « revient sur HER CHRISTOPHER (14) » : complément, pas sujet
                continue
            sujet = n; break
        if sujet is None and dernier is not None and PRONOM.search(ph):
            sujet = dernier                              # « Il termine fort… » : même cheval que la phrase d'avant
        if sujet is not None:
            out.setdefault(sujet, []).append(ph.strip()); dernier = sujet
    for m in re.finditer(r"N[°o]\s?(\d{1,2})\s+([A-ZÀ-Ý][^\n(]{1,40})(?:\([^)]*\))?\s*[:\-–]?\s*([^\n]{20,400})", t):
        out.setdefault(int(m.group(1)), []).append(m.group(3).strip())
    ch = {str(n): {"texte": " ".join(dict.fromkeys(v))[:900], "styles": styles(" ".join(v))} for n, v in out.items()}
    return z[:6000], ch


def lire_jour(jour):
    p = os.path.join(DOSSIER, "donnees", f"{jour.year}", f"{jour.month:02d}", f"{jour.isoformat()}.json.gz")
    if not os.path.exists(p): return None
    with gzip.open(p, "rt", encoding="utf-8") as f: return json.load(f)


def tab(b):
    return [dict(zip(b["colonnes"], l)) for l in b["lignes"]]


def chemin_sortie(jour):
    return os.path.join(SORTIE, f"{jour.year}", f"{jour.month:02d}", f"{jour.isoformat()}.json.gz")


def telecharger(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Yanis/1.0)", "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def collecter_jour(jour, limite=None):
    j = lire_jour(jour)
    if not j or "courses" not in j: return "pas de courses collectées"
    chemin = chemin_sortie(jour)
    deja = {}
    if os.path.exists(chemin):
        with gzip.open(chemin, "rt", encoding="utf-8") as f: deja = json.load(f)
    parts = {}
    for p in tab(j["partants"]): parts.setdefault((p["r"], p["c"]), []).append(p)
    n = vides = 0
    for c in tab(j["courses"]):
        cle = f"R{c['r']}C{c['c']}"
        if not c.get("arrivee") or (cle in deja and deja[cle].get("v") == 2): continue
        if limite and time.time() > limite: break
        try:
            page = telecharger(URL.format(date=jour.isoformat(), r=c["r"], c=c["c"]))
            brut, ch = extraire(page, parts.get((c["r"], c["c"])))
            deja[cle] = {"v": 2, "brut": brut, "chevaux": ch}
            n += 1; vides += 0 if ch else 1
        except Exception as e:
            deja[cle] = {"erreur": str(e)[:120]}
        time.sleep(PAUSE)
    if deja:
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        with gzip.open(chemin, "wt", encoding="utf-8") as f: json.dump(deja, f, ensure_ascii=False, separators=(",", ":"))
    return f"{n} courses lues ({vides} sans commentaire exploitable)"


def complet(jour):
    p = chemin_sortie(jour); j = lire_jour(jour)
    if not os.path.exists(p) or not j: return False
    with gzip.open(p, "rt", encoding="utf-8") as f: d = json.load(f)
    return all(d.get(f"R{c['r']}C{c['c']}", {}).get("v") == 2 for c in tab(j["courses"]) if c.get("arrivee"))


def main():
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("jour"); a.add_argument("date")
    b = sp.add_parser("collecte"); b.add_argument("--budget", type=float, default=8)
    t = sp.add_parser("test"); t.add_argument("fichier")
    args = ap.parse_args()
    if args.cmd == "test":
        print(json.dumps(extraire(open(args.fichier, encoding="utf-8").read())[1], ensure_ascii=False, indent=1)); return
    if args.cmd == "jour":
        print(collecter_jour(dt.date.fromisoformat(args.date))); return
    limite = time.time() + args.budget * 60
    auj = dt.date.today()
    for k in (1, 0):
        d = auj - dt.timedelta(days=k); print(d, collecter_jour(d, limite), flush=True)
    d = auj - dt.timedelta(days=2)
    while time.time() < limite and d >= dt.date(2025, 9, 1):
        if not complet(d) and lire_jour(d): print(d, collecter_jour(d, limite), flush=True)
        d -= dt.timedelta(days=1)


if __name__ == "__main__":
    main()
