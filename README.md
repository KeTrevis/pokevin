# Coach d’arène · Poke’Catch

Extension Chrome / Edge / Firefox, version 0.4.4. Compatible avec le build du jeu
`b095b65025` (v0.4.72), sans natures de Pokémon.

## Installation

### Chrome et Edge (121 ou ultérieur)

1. Ouvrir `chrome://extensions` ou `edge://extensions`.
2. Activer le **Mode développeur**.
3. Cliquer sur **Charger l’extension non empaquetée**, puis choisir ce dossier
   `extension` (celui qui contient `manifest.json`).
4. Ouvrir le jeu local avec `Jouer.cmd`, puis `http://localhost:8080`.
5. Dans le jeu, ouvrir **Progression**, puis sélectionner un chapitre d’arène.
6. Le pourcentage apparaît automatiquement à côté du niveau conseillé et de la
   météo, dans la fiche du chapitre. Son infobulle reprend le style du jeu et
   affiche uniquement « Chance of defeating the Gym Leader, calculated with the current team at 100% HP. ».
   Le badge est uniquement informatif.
7. Cliquer sur **✨ Proposer une équipe**, sous les badges, pour chercher une
   composition parmi les Pokémon disponibles dans l’équipe et le PC.

Après une mise à jour, recharger l’extension dans la page des extensions, puis
recharger l’onglet du jeu. Les estimations sont entièrement automatiques.

### Firefox (140 ou ultérieur)

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. Cliquer sur **Charger un module complémentaire temporaire**.
3. Sélectionner le même fichier `extension/manifest.json`.
4. Ouvrir le jeu, puis **Progression** et un chapitre d’arène.

Le dossier et le manifeste sont communs aux deux navigateurs. Chrome utilise
un service worker ; Firefox charge les scripts d’arrière-plan dans l’ordre
déclaré. La déclaration Firefox indique qu’aucune donnée n’est transmise.
Le chargement temporaire disparaît au redémarrage de Firefox ; une installation
durable demandera une version signée par Mozilla. Aucune publication ni signature
n’a été effectuée. Safari n’est pas ciblé ni testé pour le moment.

Les composants React `Badge`, `Tooltip`, `ActionButton` et `TeamAdvisor` sont décrits dans
[ui/README.md](ui/README.md). Ils utilisent les styles et variables de thème du
jeu. React est embarqué dans l’extension ; aucun CDN n’est utilisé.

L’extension accepte aussi le domaine officiel. Si le nom du bundle ne correspond
pas à celui du moteur embarqué, un avertissement orange signale que les résultats
peuvent être inexacts ; la simulation et la recherche d’équipe restent disponibles.

## Aperçu des dresseurs

Dans **Progression**, sélectionner un chapitre puis déplier **Dresseurs et équipes**.
L’aperçu montre les dresseurs nommés et champions dans l’ordre du parcours,
avec portrait, lieu, Pokémon et niveaux ajustés par les règles du jeu.
Les doublons dans une équipe sont conservés. Les équipes des dresseurs de route
et des assistants d’arène étant aléatoires, elles ne sont pas prédites.
Les chapitres verrouillés, sans équipe fixe et la fiche groupée de la Ligue
n’affichent pas cet aperçu. Aucune action ne modifie la sauvegarde.

Les données d’aperçu sont indépendantes du moteur de simulation : elles viennent
du bundle officiel `app.c4d608a3a9.js` consulté le 4 novembre 2026.
Un avertissement apparaît si le jeu utilise un autre bundle.
Pour actualiser ces données depuis un bundle original téléchargé :

```sh
node tools/build_chapter_preview.cjs /chemin/app.<hash>.js
npm run test:preview
```

Le générateur extrait les équipes et applique les fonctions natives de calcul des
niveaux pendant la construction. L’extension ne télécharge ni n’exécute de code du
jeu à l’exécution. Pour vérifier les interactions et l’affichage sur le site actuel :

```sh
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright node tests/chapter-preview.browser.cjs
```

Ce test utilise un profil temporaire et une sauvegarde synthétique. Il vérifie
les chapitres verrouillés, la navigation, le clavier, les thèmes clair/sombre,
l’affichage mobile et l’absence d’écriture par l’aperçu ; les captures de bureau
1920 × 1080 sont enregistrées dans `artifacts/`.

## Ce que mesure le résultat

- Un duel **direct contre le champion**, sans les dresseurs et trajets avant lui.
- L’équipe **actuellement en route**, avec les mêmes niveaux, XP,
  chromatiques, rangs et réglage des changements automatiques. Si une autre
  équipe attend le prochain Centre Pokémon, le calcul utilise encore celle
  actuellement en route.
- Un seul mode : **tous les Pokémon soignés**, statuts retirés au départ.
- Chaque essai repart de la même copie. Les gains d’XP pendant le combat sont
  exécutés par le moteur, puis abandonnés avec la copie à la fin de l’essai.
- Les évolutions automatiques sont appliquées entre les actions, avec les
  règles du jeu pour les statistiques, les PV et les évolutions bloquées.
  Les animations sont exclues. Si une évolution demande un choix du joueur
  avant la fin du combat, aucune probabilité n’est affichée pour cet essai :
  le badge indique « Indisponible » jusqu’à ce que la situation soit résolue
  dans la vraie partie. Un choix après le dernier K.O. ne change pas le résultat.
- Les Pokémon et niveaux du champion, bonus de PV / dégâts, attaques, statuts,
  doubles combats et tirages aléatoires proviennent du véritable moteur.
- Les bonus temporaires sont évalués à l’heure de lecture de la sauvegarde.
  Le temps est figé pour comparer des combats dans les mêmes conditions.
- L’estimation repose sur 100 combats indépendants. Une fréquence de
  100 % sur un échantillon n’est pas une garantie.

La lecture porte sur la dernière sauvegarde automatique du jeu. Les changements
de composition, de niveau, d’XP, de rang ou de réglage de combat
actualisent l’estimation. Les PV et statuts actuels sont ignorés puisque l’équipe
part soignée. Pour limiter la charge pendant le farm, les actualisations pour un
même chapitre sont espacées d’au moins 10 secondes. Le dernier pourcentage
reste visible pendant les actualisations, puis est remplacé directement par
la nouvelle valeur. « Calcul… » apparaît uniquement lorsqu’aucun résultat
n’est encore disponible pour le champion affiché, y compris après un retour
sur sa fiche. Aucun clic ne déclenche de recalcul.
Les actualisations reprennent aussi après un retour avec Précédent ou Suivant,
même si le navigateur restaure la page depuis son cache.
Les résultats récents sont conservés en mémoire pour éviter de recalculer à
chaque sélection ou rafraîchissement de la fiche. Les chapitres sans champion
d’arène n’affichent pas de pourcentage. Les modes événement, raid, zone
légendaire et Tour ne sont pas pris en
charge : revenir à l’aventure normale.

## Proposition d’équipe

La recherche utilise les Pokémon de l’équipe et du PC, avec leurs niveaux,
rangs et formes actuels. Elle respecte les restrictions de région et
les groupes de doublons du jeu. Les Pokémon en pension, en expédition ou déposés
pour un échange ne sont pas disponibles. La recherche seule ne modifie pas l’équipe.

Le moteur sélectionne des candidats avec le score de matchup natif, puis teste
réellement des compositions, des remplacements et des ordres différents :
12 combats par composition pendant la recherche, puis 100 nouveaux combats
pour chacune des quatre finalistes et l’équipe actuelle. Les tirages sont
reproductibles pour un même instantané et partagés entre compositions comparées.
À égalité de victoires dans la comparaison finale, l’équipe actuelle est conservée.
Les compositions nécessitant un choix manuel d’évolution pendant le combat sont
écartées plutôt que de choisir une évolution à la place du joueur.

**Meilleure équipe trouvée** désigne le résultat de cette recherche limitée,
pas une garantie d’optimalité parmi toutes les combinaisons et tous les ordres.
Le résultat affiche les Pokémon dans l’ordre proposé et leur chance de victoire,
avec les équipes soignées. **Appliquer cette équipe** utilise les commandes natives
du PC, synchronise la composition et son équipe enregistrée, puis revient à la
fiche du chapitre. En route, le changement prend effet au prochain Centre Pokémon,
comme une modification manuelle. Le bouton ne soigne aucun Pokémon.
Une proposition contenant un Pokémon qui n’est plus disponible ou qui a changé
de forme est refusée. En cas d’échec pendant la composition, l’extension tente
de restaurer l’équipe initiale avec les mêmes commandes natives.
Le bouton **Annuler**, la fermeture de la fiche, un changement de chapitre ou
le passage de l’onglet en arrière-plan interrompent le calcul.

## Isolation

Les fichiers sous `game/` restent inchangés. Le moteur embarqué est exécuté dans
le service d’arrière-plan de l’extension, avec une copie de la sauvegarde. Son accès au
stockage est désactivé et ses modules de réseau, comptes et interface sont
exclus. Les simulations n’écrivent pas dans la sauvegarde et aucun résultat n’est
envoyé à un serveur. Seul le clic sur **Appliquer cette équipe** change réellement
la composition, via le PC du jeu, qui effectue lui-même sa sauvegarde.

Le script d’affichage s’exécute automatiquement uniquement sur les adresses
HTTP `localhost`, `127.0.0.1` et le domaine HTTPS
`pokecatch-online.netlify.app`. Il ajoute un badge au DOM et lit la sauvegarde.
Le calcul est découpé en petits lots annulables dès que la fiche est quittée ou
que le champion change. Il n’y a ni stockage persistant ni script téléchargé.

## Reproduction et vérification

Depuis la racine du dépôt, avec Python 3 et Node 18 ou ultérieur :

```powershell
python tools/build_extension_engine.py /chemin/app.5f011bb067.js --build b095b65025
node --test tests/simulator.test.cjs tests/optimizer.test.cjs
node tests/firefox.test.cjs
```

Le test Firefox nécessite Node 22+ et Firefox installé. Il utilise un profil
temporaire et une sauvegarde synthétique, installe réellement l’extension avec
WebDriver BiDi et vérifie le badge, la recherche et l’application native d’équipe.
`FIREFOX_EXECUTABLE` permet de préciser le chemin du navigateur si nécessaire.

`GAME_BUNDLE` permet de préciser le bundle original utilisé pour les tests de
parité (par défaut `../game/bundle/` et le nom dans `engine/version.json`).
`GAME_DIR` désigne la copie locale du site pour les tests navigateur (par défaut
`../game`). Le bundle original et les fichiers du site ne sont pas inclus ici.

Pour reconstruire les composants React (le bundle prêt à charger est fourni) :

```powershell
npm ci
npm run build:extension
```

Les versions de React et d’esbuild sont verrouillées par `package-lock.json`.
Node n’est nécessaire que pour développer ou reconstruire l’extension.

Le générateur recopie deux tranches **sans réécriture** du bundle du jeu :
données puis règles d’environnement, Pokémon, progression et aventure. Seuls
l’environnement isolé et un export interne sont ajoutés autour. La version et
l’empreinte SHA-256 du bundle d’origine sont dans `engine/version.json`.

Les tests comparent les événements des combats au bundle original, chargé avec
son propre préambule et sa construction normale de chapitre, sur 33 champions
et quatre graines aléatoires chacun. Ils vérifient aussi le soin, l’absence de
mutation de la sauvegarde, l’équipe en route, les défaites face à un champion
déjà battu et les bornes statistiques. Un test compare les effets d’une
évolution en combat aux vrais gestionnaires d’évolution de l’interface du jeu.

Un contrôle navigateur optionnel se lance avec
`node extension/tests/browser.test.cjs`, si Playwright et un Chromium récent
sont déjà installés. `PLAYWRIGHT_MODULE` peut désigner un paquet Playwright
existant, et `BROWSER_EXECUTABLE` le chemin du navigateur. Le test utilise un
profil temporaire et une équipe fictive. Il vérifie le badge automatique,
l’absence d’écriture dans la sauvegarde, le cache, le recalcul après changement
de niveau, la navigation rapide entre champions et l’avertissement de
version sans blocage du calcul. Il vérifie ensuite l’emplacement et la navigation dans la vraie copie
locale du jeu, y compris sur petit écran, ainsi qu’une vraie restauration du
cache de navigation après modification de la sauvegarde. Il ne lit pas le
profil du joueur.

Le code et les données du jeu restent la propriété de leurs auteurs. Copie
destinée à cet usage personnel ; aucune publication de l’extension n’a été faite.
