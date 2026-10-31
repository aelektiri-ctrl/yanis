# Yanis – pronostics hippiques (étape 1)

**L'appli :** https://aelektiri-ctrl.github.io/yanis/ — à ajouter à l'écran d'accueil du téléphone.

Yanis collecte tout seul, chaque heure, le programme, les partants, les cotes, les arrivées et les rapports du PMU (réunions françaises). Il remonte aussi 10 ans d'historique, puis prépare l'appli.

- **Les données** : dossier `donnees/`, un fichier par journée (`AAAA/MM/AAAA-MM-JJ.json.gz`), jamais effacé.
- **Le football** : `sport.py` — 18 championnats, 10 saisons de résultats et de cotes (football-data.co.uk), modèle de probabilités, double filtre (proba > 50 % et value) et banc d'essai honnête. Les scores en direct de tous les sports viennent d'ESPN, directement dans l'appli.
- **Le bilan** : fichier [BILAN.md](BILAN.md), mis à jour après chaque passage.
- **Lancer à la main** : onglet *Actions* → *Yanis - collecte PMU* → *Run workflow*.
