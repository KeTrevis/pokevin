# Compatibilité des versions du jeu

- Une différence de version entre le moteur embarqué dans l’extension et le moteur réel du jeu ne doit jamais, à elle seule, bloquer une fonctionnalité, une simulation ou l’affichage d’un résultat.
- Continuer à utiliser le moteur embarqué et afficher un simple avertissement dans le tooltip concerné : « Version du jeu différente : les résultats peuvent être inexacts. »
- Ne pas afficher « Indisponible », désactiver une action ou exiger une mise à jour uniquement à cause de cette différence de version.
- Les erreurs réelles de données ou d’exécution restent à gérer normalement ; elles ne doivent pas être masquées par cette règle.
