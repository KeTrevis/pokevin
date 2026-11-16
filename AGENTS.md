# Compatibilité des navigateurs

- L’extension doit rester compatible avec Firefox et Google Chrome. Toute modification doit préserver le fonctionnement sur les deux navigateurs.

# Tests avec le jeu réel

- Au début de chaque session de travail, récupérer depuis https://pokecatch-online.netlify.app/# le frontend actuellement servi et son moteur, en suivant le `boot.js` et le CDN référencés. Ne pas supposer que la copie locale d’une session précédente est à jour.
- Comparer le bundle et son SHA-256 à `engine/version.json`. Si le moteur du jeu a changé, mettre à jour le moteur embarqué avec `tools/build_extension_engine.py` et les métadonnées de version avant de modifier ou tester l’extension. Adapter l’extracteur si nécessaire, puis vérifier les simulations contre le jeu réel sur Chrome et Firefox.
- Lors d’une mise à jour du moteur, régénérer aussi `ui/chapter-data.js` avec `tools/build_chapter_preview.cjs` depuis le même bundle, afin que les aperçus des dresseurs restent synchronisés.
- Avant chaque release, revérifier la version servie et inclure le moteur à jour dans le ZIP publié. Une version identique ne nécessite pas de régénération inutile.
- Pour tester l’extension, aller sur https://pokecatch-online.netlify.app/# et télécharger le frontend actuellement servi (HTML, scripts, styles et ressources nécessaires, y compris ceux du CDN référencé) afin de faire tourner une copie locale du jeu.
- Reproduire et vérifier le parcours sur cette copie locale avec le format de sauvegarde du jeu actuel ; les fixtures synthétiques seules ne suffisent pas. Garder les fichiers téléchargés hors du code versionné, par exemple dans `artifacts/game/`, et ne pas utiliser de compte personnel ni écrire de données de test en production.

# Navigateur de test

- Pour tester l’extension, ouvrir un navigateur dans le harness, y charger l’extension et ouvrir la copie locale du jeu afin de vérifier le parcours concerné.

# Compatibilité des versions du jeu

- Une différence de version entre le moteur embarqué dans l’extension et le moteur réel du jeu ne doit jamais, à elle seule, bloquer une fonctionnalité, une simulation ou l’affichage d’un résultat.
- Continuer à utiliser le moteur embarqué et afficher un simple avertissement dans le tooltip concerné : « Version du jeu différente : les résultats peuvent être inexacts. »
- Ne pas afficher « Indisponible », désactiver une action ou exiger une mise à jour uniquement à cause de cette différence de version.
- Les erreurs réelles de données ou d’exécution restent à gérer normalement ; elles ne doivent pas être masquées par cette règle.
