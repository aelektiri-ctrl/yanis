# Recherche de « coïncidences » sur l'historique PMU (9 novembre 2026)

Base : 14 728 courses, 173 426 partants (sept. 2025 – nov. 2026), rapports officiels pour 1 €.
Règle : un motif ne compte que s'il se reproduit sur des courses qu'il n'a jamais vues.

| Test | Résultat |
|---|---|
| ~221 000 combinaisons de 2 facteurs (hippodrome, discipline, distance, cote, driver, entraîneur, père, ferrure, œillères, corde, musique, mouvement de cote…) | 470 motifs rentables avant juin (+53 % en moyenne) |
| Les mêmes motifs après juin | −20,6 % en moyenne (référence : −23 %) |
| Motifs trouvés avant juin ET confirmés juin–août, joués sept.–nov. | −27,3 % ; 20 % positifs contre 25 % pour des motifs pris au hasard |
| Gradient boosting (toutes interactions), prédiction | égal au public (n°1 : 31,3 % vs favori 31,5 % en sept.–nov.) |
| Gradient boosting, règle value (valeur ≥ 1,30, cote 6–30) choisie sur juin–août | sept.–nov. : 138 paris, 9 gagnants, ROI +32,8 % ; intervalle à 90 % : −38 % à +116 % ; 25 % de chances que le vrai ROI soit négatif |

Conclusion : les coïncidences issues de la fouille ne tiennent pas. Seule piste à suivre : la règle value du gradient boosting, à valider en conditions réelles sur plusieurs mois.
