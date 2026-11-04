# Composants React de l’extension

Les composants sont indépendants de la simulation. Leurs sources se trouvent
dans `components/`, et `react-ui.js` est le bundle de production généré avec
React et React DOM. Aucun script externe n’est chargé à l’exécution.

## Utilisation dans une interface React

```jsx
import { Badge } from './components/Badge.jsx';
import { Tooltip } from './components/Tooltip.jsx';

<Badge
  icon="⚔️"
  label="Victoire"
  value="87 %"
  tone="positive"
  tooltip="Chance of defeating the Gym Leader, calculated with the current team at 100% HP."
/>

<Tooltip content="Une explication courte.">
  <button type="button">Informations</button>
</Tooltip>
```

`Badge` accepte une icône, un libellé, une valeur et les tons `neutral`, `info`,
`positive`, `caution` et `negative`. Sans `onClick`, il affiche un `span` ; avec,
un vrai bouton. L’estimateur utilise uniquement la variante informative.

`Tooltip` prend un seul élément DOM comme déclencheur. Il conserve les
gestionnaires d’événements et la référence de cet élément. La bulle s’affiche
au survol ou au focus, se ferme avec Échap et reste dans les limites de
l’écran. `aria-describedby` relie le déclencheur au contenu. La bulle est
rendue dans le corps de la page pour éviter d’être coupée par les panneaux.

## Intégration avec le contrôleur existant

`index.jsx` fournit un petit pont pour le script de contenu qui pilote les
calculs sans React :

```js
const badge = PokeCatchUI.mountBadge(container, {
  id: 'mon-badge', icon: '⚔️', label: 'Victoire', value: '87 %',
  tone: 'positive', tooltip: 'Chance of defeating the Gym Leader, calculated with the current team at 100% HP.',
});

PokeCatchUI.updateBadge(badge, { value: '91 %', tone: 'positive' });
```

`ActionButton` accepte `children`, `onClick` et `disabled` et réutilise les classes
natives `btn small ghost`. `TeamAdvisor` reçoit `advice`, `versionMismatch`, `onSearch`, `onCancel` et `onApply` :
il affiche les états `idle`, `searching`, `applying`, `result` ou `error`, sans connaître le
moteur, le stockage ou les ports de l’extension. `advice.result` contient la
proposition, `advice.teams` / `stage` la progression, `advice.applied` le succès
de l’application et `advice.message` une éventuelle erreur.
`versionMismatch` affiche un avertissement orange sans bloquer les actions.

Le pont `mountAdvisor(afterElement, props)` insère ce composant après un élément
existant ; `updateAdvisor(element, props)` met ses propriétés à jour. Il partage
avec `Badge` le montage React et le nettoyage des racines détachées.

Le conteneur `pc-ui-root` n’ajoute aucune boîte visuelle. Quand le jeu retire
un panneau, l’observateur de `content.js` passe ses nœuds supprimés à
`PokeCatchUI.disposeDetached`. Le composant React est alors démonté, y compris
sa bulle et ses écouteurs. Un composant déplacé sans être détaché est conservé.

## Style et construction

`ChapterPreview` reçoit `trainers` et `versionMismatch` et utilise
un élément natif `details` pour le clavier et l’ouverture. `mountPreview` l’insère
après les badges du chapitre ; les portraits et Pokémon utilisent les assets du
jeu. Les équipes et niveaux sont générés dans `chapter-data.js` depuis le bundle
officiel, sans chargement de code distant dans l’extension. Les entrées `random`
portent `count`, `classes`, `size` et un ensemble de Pokémon possibles avec `min` /
`max` ; les équipes fixes conservent les doublons et le champ `level`.
Les équipes sont rendues à l’ouverture d’un `Tooltip` avec `interactive`, au survol,
au focus ou au toucher. Sa variante interactive permet de traverser l’espace entre
la ligne et la bulle, de faire défiler la liste et de fermer par Échap ou toucher extérieur.

`badge.css` reprend `.mp-chips span`, `.pg-lv` et `.mp-chips > .wx` du fichier
`game/bundle/app.3f7c34e1ef.css`. `Tooltip` réutilise les classes natives
`bag-tip`, `info-tip-box` et `ftip`. `tooltip.css` reprend la typographie des
infobulles du site. Les variables natives assurent les thèmes clair et sombre.

Depuis la racine du dépôt :

```powershell
npm ci
npm run build:extension
```

Le manifeste charge le bundle généré avant `content.js`. Il faut le reconstruire
après une modification des fichiers JSX, puis recharger l’extension et le jeu.
