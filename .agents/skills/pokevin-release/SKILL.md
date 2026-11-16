---
name: pokevin-release
description: Préparer ou publier une release de l’extension Pokevin en vérifiant le moteur du jeu, les contrôles et le contenu du ZIP. À utiliser pour une demande de release ou une modification du workflow de publication.
---

# Release de Pokevin

Ne créer ni publier de release sans demande explicite de l’utilisateur. À chaque release, rédiger un changelog non technique dans sa description, centré sur les nouveautés et changements visibles pour les joueurs, sans jargon ni détails d’implémentation.

Lire la section « Releases » du [README.md](../../../README.md) et le [workflow de release](../../../.github/workflows/release.yml), qui définissent le mécanisme de publication du dépôt.

1. **Avant chaque release**, récupérer à nouveau la version actuellement servie du jeu et comparer le bundle et son SHA-256 à `engine/version.json`, même si une vérification a déjà eu lieu dans la session. Suivre [pokevin-engine](../pokevin-engine/SKILL.md). Inclure le moteur à jour dans le ZIP ; une version identique n’exige pas de régénération.
2. Effectuer les vérifications du parcours modifié sur Chrome et Firefox selon [pokevin-testing](../pokevin-testing/SKILL.md). Lors d’une mise à jour du moteur, vérifier aussi les simulations et les aperçus des chapitres depuis le même bundle.
3. Exécuter `npm run typecheck` et `npm run build:extension`. Vérifier le contenu du ZIP défini par le workflow : moteur et métadonnées, scripts et styles de l’extension, HTML et workers Monaco, polices et licences nécessaires. Les téléchargements du jeu, profils de test et dépendances de développement restent hors de l’archive.
4. Suivre le workflow existant : chaque push sur `main` déclenche la compilation et la publication de `pokevin.zip`. Le CI calcule la version à quatre nombres à partir de `manifest.json` et du numéro d’exécution GitHub Actions ; il ne crée pas de commit de version.

Ne pas créer manuellement de tag ou de release : les releases manuelles ne déclenchent pas ce workflow. Une relance du workflow remplace le ZIP de la release existante.
