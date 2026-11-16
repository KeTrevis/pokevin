# Compatibilité des navigateurs

- L’extension doit rester compatible avec Firefox et Google Chrome. Toute modification doit préserver le fonctionnement sur les deux navigateurs.

# Tests avec le jeu réel

- Pour tester l’extension, aller sur https://pokecatch-online.netlify.app/# et télécharger le frontend actuellement servi (HTML, scripts, styles et ressources nécessaires, y compris ceux du CDN référencé) afin de faire tourner une copie locale du jeu.
- Reproduire et vérifier le parcours sur cette copie locale avec le format de sauvegarde du jeu actuel ; les fixtures synthétiques seules ne suffisent pas. Garder les fichiers téléchargés hors du code versionné, par exemple dans `artifacts/game/`, et ne pas utiliser de compte personnel ni écrire de données de test en production.

# Navigateur de test

- Pour tester l’extension, ouvrir un navigateur dans le harness, y charger l’extension et ouvrir la copie locale du jeu afin de vérifier le parcours concerné.

# Compatibilité des versions du jeu

- Une différence de version entre le moteur embarqué dans l’extension et le moteur réel du jeu ne doit jamais, à elle seule, bloquer une fonctionnalité, une simulation ou l’affichage d’un résultat.
- Continuer à utiliser le moteur embarqué et afficher un simple avertissement dans le tooltip concerné : « Version du jeu différente : les résultats peuvent être inexacts. »
- Ne pas afficher « Indisponible », désactiver une action ou exiger une mise à jour uniquement à cause de cette différence de version.
- Les erreurs réelles de données ou d’exécution restent à gérer normalement ; elles ne doivent pas être masquées par cette règle.
