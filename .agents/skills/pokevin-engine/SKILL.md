---
name: pokevin-engine
description: Synchroniser le moteur et les données embarqués de Pokevin avec le jeu actuellement servi. À utiliser au début de chaque session sur ce dépôt, lors d’une évolution du jeu ou avant une release.
---

# Moteur du jeu

Depuis la racine du dépôt, récupérer le frontend actuellement servi sur https://pokecatch-online.netlify.app/#. Suivre son `boot.js` et le CDN qu’il référence pour trouver le build et le bundle réels. Ne pas présumer qu’un téléchargement d’une session précédente est à jour.

Comparer le nom du bundle et son SHA-256 à [engine/version.json](../../../engine/version.json). Garder les téléchargements hors du code versionné, par exemple dans `artifacts/game/`.

- Si les empreintes sont identiques, ne pas régénérer inutilement les fichiers.
- Si le moteur a changé, le mettre à jour **avant de modifier ou tester l’extension** avec [tools/build_extension_engine.py](../../../tools/build_extension_engine.py), en passant le bundle original et le `--build` du même `boot.js`. L’outil écrit aussi les métadonnées de version. Adapter l’extracteur si nécessaire.
- Lors de cette mise à jour, régénérer aussi `ui/chapter-data.js` avec `node tools/build_chapter_preview.cjs <bundle-original>`, depuis ce même bundle.
- Vérifier ensuite les simulations contre le jeu réel sur Chrome et Firefox en suivant [pokevin-testing](../pokevin-testing/SKILL.md).

## Différence de version à l’exécution

Une différence entre le moteur embarqué et celui du jeu ne doit jamais, à elle seule, bloquer une fonctionnalité, une simulation ou l’affichage d’un résultat.

Continuer à utiliser le moteur embarqué et afficher seulement cet avertissement dans le tooltip concerné : « Version du jeu différente : les résultats peuvent être inexacts. »

Ne pas afficher « Indisponible », désactiver une action ou exiger une mise à jour uniquement pour cette différence. Gérer normalement les véritables erreurs de données ou d’exécution ; ne pas les masquer.
