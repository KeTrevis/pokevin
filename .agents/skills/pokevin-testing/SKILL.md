---
name: pokevin-testing
description: Préserver la compatibilité Chrome et Firefox et tester les changements de Pokevin sur une copie locale du jeu réel. À utiliser pour toute modification de l’extension et pour vérifier un parcours demandé dans le navigateur.
---

# Compatibilité et tests de Pokevin

L’extension doit rester compatible avec **Google Chrome et Firefox**, aux versions minimales indiquées dans [manifest.json](../../../manifest.json). Vérifier le parcours concerné sur les deux navigateurs.

## Copie locale du jeu actuel

S’appuyer sur la vérification de version du début de session décrite dans [pokevin-engine](../pokevin-engine/SKILL.md). Si elle n’a pas été faite dans cette session, la faire avant les tests.

Télécharger le frontend servi sur https://pokecatch-online.netlify.app/# : HTML, scripts, styles et ressources nécessaires, y compris ceux du CDN indiqué par `boot.js`. Faire tourner cette copie localement, avec le format de sauvegarde du jeu actuel. Garder les téléchargements sous `artifacts/game/` ou dans un autre emplacement ignoré par Git.

Reproduire le parcours sur ce frontend réel ; les fixtures synthétiques seules ne suffisent pas. Ne pas utiliser de compte personnel ni écrire de données de test en production.

## Navigateur de test

Ouvrir un navigateur dans le harness, y charger l’extension et ouvrir la copie locale du jeu. Reprendre les scripts existants et leur préparation de sauvegarde, plutôt que créer un autre environnement :

- [tests/automation.browser.cjs](../../../tests/automation.browser.cjs) : extension réelle sur Chromium, bibliothèque de scripts, éditeur et redémarrage après un roaming. `GAME_URL` désigne la copie locale et `PLAYWRIGHT_MODULE` permet d’utiliser le module Playwright disponible dans le harness.
- [tests/firefox.test.cjs](../../../tests/firefox.test.cjs) : extension réelle sur Firefox ; `GAME_DIR` désigne le frontend téléchargé.
- Les autres vérifications et commandes sont documentées dans [README.md](../../../README.md), section « Reproduction et vérification ».

Adapter les checks au changement. Après une mise à jour du moteur, vérifier aussi les simulations contre le même frontend réel sur les deux navigateurs.

## Navigateur partagé

Ne pas ouvrir, recharger ni manipuler le navigateur partagé automatiquement après un changement. Le faire seulement sur demande explicite de l’utilisateur, puis le laisser sur le parcours concerné. Préserver la sauvegarde et les scripts de l’utilisateur. Vérifier la version réellement chargée dans l’onglet : un build réussi ou un serveur à jour ne rafraîchit pas une page déjà ouverte.

Pour un changement de l’API ou de la navigation, recharger le jeu pour charger son runtime. Pour un changement limité à l’éditeur, un rechargement de son iframe peut suffire. Une démo sans extension sert à montrer le résultat ; elle ne remplace pas les tests avec l’extension chargée dans le harness.
