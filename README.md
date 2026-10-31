# Yanis – Étape 1 : la grande bibliothèque hippique

Yanis collecte tout seul, deux fois par jour, le programme, les partants, les cotes, les arrivées et les rapports du PMU (réunions françaises), et remonte 10 ans d'historique petit à petit.

- **Les données** : dossier `donnees/`, un fichier par journée (`AAAA/MM/AAAA-MM-JJ.json.gz`), jamais effacé.
- **Le bilan** : fichier [BILAN.md](BILAN.md), mis à jour après chaque passage.
- **L appli** : https://aelektiri-ctrl.github.io/yanis/ (à ajouter à l écran d accueil).
- **Lancer à la main** : onglet *Actions* → *Yanis - collecte PMU* → *Run workflow*.

Passages automatiques : chaque heure. Chaque passage met à jour les courses du jour (programme, cotes, résultats), prépare l appli, puis avance dans l historique.
