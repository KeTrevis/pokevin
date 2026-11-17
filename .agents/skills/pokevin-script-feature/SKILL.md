---
name: pokevin-script-feature
description: Créer ou porter une fonctionnalité Pokevin en script fourni et étendre son API avec des primitives réutilisables. À utiliser pour les calculateurs, indicateurs et automatisations réalisés via la bibliothèque de scripts de cette extension.
---

# Features Pokevin par script

La feature appartient au script fourni. L’API expose des moyens de lire les données, d’exécuter des opérations natives isolées et d’observer ou de piloter le jeu ; elle ne fournit pas la réponse métier du calculateur.

## Répartir les responsabilités

Dans ce dépôt, lire `plugin/scripts/`, `plugin/sdk/` et `plugin/types/`. Lire les scripts fournis, le contrat typé de l’API, son bridge et les opérations du moteur avant de modifier la surface publique. Réutiliser les primitives déjà disponibles.

Garder dans le script le choix des cibles, les répétitions, les critères d’arrêt propres au calculateur, l’agrégation, la formule, le classement, le formatage et la progression. Par exemple, un calculateur d’XP/h additionne les événements d’XP et rapporte ce total au temps simulé dans le script : ne pas exposer `getXpRate`, ni déplacer le calcul complet derrière un nom générique.

Si une primitive manque, exposer l’opération sous-jacente et ses données brutes avec des paramètres explicites. Expliquer un autre usage concret de la même opération avant de l’ajouter. Une simulation de parcours peut servir à observer l’XP, le butin ou les défaites ; un wrapper qui renvoie uniquement le rendement XP reste spécifique même s’il s’appelle `simulate`.

Ne pas exposer le moteur entier, des noms de fonctions arbitraires, du code à exécuter dans le worker, ni des objets mutables du runtime. Les simulations travaillent sur une copie de la sauvegarde ; les actions qui modifient la vraie partie restent explicites. Préserver les limites d’exécution, l’annulation et l’isolation entre scripts.

La simulation de parcours est accessible directement via `pokevin.simulate(save, chapterId, options)` (ou `simulate` dans le scope de visite). Réutiliser cette primitive pour les mesures issues des parcours.

## Format des typings

Pour toute création ou modification de script, utiliser systématiquement des blocs JSDoc multilignes. La première ligne contient uniquement `/**` et la dernière uniquement `*/` : aucune annotation sur ces deux lignes. Mettre chaque annotation (`@param`, `@returns`, `@type`, etc.) sur sa propre ligne, précédée de `*`. Cette règle s’applique à tous les scripts :

```js
/**
 * @param {number} param1
 * @param {number} param2
 */
```

## Intégrer et vérifier

Les scripts fournis servent uniquement à initialiser une nouvelle bibliothèque.
Tous les scripts sont modifiables, renommables et supprimables dans la même liste.
Ne pas écraser du code enregistré, recréer un script supprimé, ni créer de copie
personnelle automatique lors d’une mise à jour. Préserver les noms, le code, la
sélection et le choix de démarrage automatique des anciennes bibliothèques.
Exécuter active le démarrage automatique ; arrêter le désactive pour tout script.

Mettre à jour ensemble le contrat TypeScript, la documentation de l’éditeur, le
bridge, les opérations d’arrière-plan et les tests concernés. Supprimer un ancien
chemin seulement si le port le remplace réellement ; un indicateur natif conservé
peut continuer à avoir ses propres appels internes.

Vérifier la primitive sur les événements du moteur réel, puis exécuter le code exact du script fourni à travers l’API publique. Couvrir l’arrêt en cours de calcul, les données invalides et l’absence de modification de sauvegarde. Suivre les instructions du dépôt pour la synchronisation du moteur, les tests Chrome/Firefox et le frontend local actuel.

Relire finalement la surface publique : un script différent peut-il recombiner ces opérations pour obtenir une autre mesure sans ajouter une nouvelle fonction métier à l’API ?
