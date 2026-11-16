# Pokevin

Extension Chrome / Edge / Firefox, version 0.4.6. Moteur embarqué synchronisé avec
le build du jeu `b05c8cc201` (bundle `app.c0081498f2.js`).

## Installation

Télécharger `pokevin.zip` depuis les [releases GitHub](https://github.com/KeTrevis/pokevin/releases),
puis extraire l’archive dans un dossier. Le ZIP contient l’extension prête à charger,
avec `manifest.json` à la racine.

### Chrome et Edge (121 ou ultérieur)

1. Ouvrir `chrome://extensions` ou `edge://extensions`.
2. Activer le **Mode développeur**.
3. Cliquer sur **Charger l’extension non empaquetée**, puis choisir ce dossier
   `extension` (celui qui contient `manifest.json`).
4. Ouvrir le jeu local avec `Jouer.cmd`, puis `http://localhost:8080`.
5. Dans le jeu, ouvrir **Progression**, puis sélectionner un chapitre d’arène ou un chapitre avec un Pokémon errant.
6. Le pourcentage apparaît automatiquement à côté du niveau conseillé et de la
   météo, dans la fiche du chapitre. Son infobulle reprend le style du jeu et
   indique l’adversaire simulé, avec l’équipe en route à 100 % de PV.
   Un Pokémon errant présent est prioritaire sur le champion, y compris pour la
   proposition d’équipe. Après son départ ou sa capture, le champion redevient la cible.
   Le badge est uniquement informatif.
7. Cliquer sur **✨ Proposer une équipe**, sous les badges, pour chercher une
   composition parmi les Pokémon disponibles dans l’équipe et le PC.

Pour une mise à jour, remplacer les fichiers dans le même dossier, recharger
l’extension dans la page des extensions, puis recharger l’onglet du jeu.
Les estimations sont entièrement automatiques.

Dans l’aventure, la timeline remplace l’herbe de la rencontre assignée à un Pokémon
errant par son sprite. Le repère suit le parcours généré,
même si le Pokémon change ensuite de chapitre sur la carte, et disparaît après sa capture.
Le contrôle `tests/roaming.browser.cjs` utilise le frontend téléchargé ;
`GAME_SAVE_BUNDLE` peut préciser le chemin de son bundle pour vérifier aussi le format compact.

La clé publique `key` du manifeste fixe l’identifiant Chrome / Edge de Pokevin,
même depuis un autre dossier ou avec une nouvelle version. Ne pas la régénérer
entre les releases. Les copies installées avant cet ajout ont des identifiants
différents : les supprimer une fois dans `chrome://extensions`, puis charger la
nouvelle version. Recharger ensuite le jeu pour retirer leurs anciens scripts.

Vérification de l’identité entre deux versions chargées depuis des dossiers distincts :
`PLAYWRIGHT_MODULE=/chemin/node_modules/playwright node tests/extension-identity.browser.cjs`.

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

## Automatisations JavaScript

Ouvrir **Scripts** dans la barre de navigation. Cet écran affiche la liste des
scripts à gauche et l’IDE dans la partie principale. **Nouveau script** crée un
script vide ; son nom se modifie au-dessus de l’éditeur. Sélectionner un script,
modifier le code puis cliquer sur l’icône **▶ Exécuter**, qui devient **■ Arrêter** pendant l’exécution (ou **Ctrl/Cmd + Entrée** pour basculer).
Les mêmes commandes et une corbeille pour supprimer le script apparaissent au survol de son nom, au focus clavier ou directement sur écran tactile. Supprimer un script actif arrête ses callbacks. L’éditeur Monaco, utilisé par VS Code,
est embarqué avec ses workers : aucune ressource d’édition ne vient d’un CDN.
Il propose la coloration JavaScript, les suggestions (`Ctrl + Espace`), les types
et la documentation de `pokevin`, l’aide aux paramètres et les diagnostics.
Il est chargé uniquement à l’ouverture de Scripts.
Modifier un script actif sauvegarde le code sans remplacer la version exécutée : l’icône **↻ Relancer** apparaît à côté de Stop. Avant de changer de script ou de quitter cet écran, une fenêtre propose de relancer, de continuer avec l’ancienne version ou d’annuler. Revenir au code exécuté ou arrêter le script retire cet avertissement.
Les noms, le code et le dernier script sélectionné sont enregistrés localement
pendant l’édition. L’ancien script unique est récupéré automatiquement sous le nom
**Mon script**. Il faut relancer le script après un rechargement. Plusieurs scripts peuvent tourner en parallèle. Relancer un script remplace uniquement ses propres abonnements.
**Arrêter**, supprimer un script actif ou appeler `pokevin.stop()` dans ce script retire seulement ses callbacks. Depuis la console, `window.pokevin.stop()` arrête tous les scripts et abonnements. Les scripts actifs sont indiqués dans la liste ; quitter
l’onglet laisse leurs callbacks actifs. Un changement de chapitre lancé depuis cet
écran conserve l’éditeur affiché.
Ces commandes ne peuvent pas interrompre une boucle JavaScript infinie ni annuler
les timers ou effets créés directement par le script.

L’API `window.pokevin` est aussi disponible dans la console du jeu :

```js
const unsubscribe = pokevin.events.onChapterStarted(({ chapterId }) => {
  console.log("Début du chapitre", chapterId);
});

pokevin.events.onChapterFinished(({ chapterId }) => {
  console.log("Chapitre terminé", chapterId);
});

// Recommencer le chapitre après un combat contre un Pokémon errant.
pokevin.events.onBattleFinished(({ chapterId, roamer }) => {
  if (roamer) return pokevin.changeChapter(chapterId);
});

// Retirer un seul abonnement :
unsubscribe();
```

`changeChapter(chapterId)` renvoie une Promise et utilise les commandes natives de la
carte : aller au chapitre ou le recommencer s’il est déjà en cours. L’identifiant
est l’index numérique du chapitre (une chaîne numérique fonctionne aussi).
Le chapitre doit être accessible dans la région affichée sur la carte. Un
identifiant invalide, un chapitre verrouillé, une fenêtre du jeu ouverte ou un
changement déjà en cours produit une erreur. Les erreurs des callbacks sont
signalées dans la console et dans l’éditeur sans interrompre les autres abonnés.

Chaque callback reçoit un objet unique contenant `chapterId`. Les callbacks à
deux paramètres de l’ancienne API doivent être adaptés ; les scripts enregistrés
ne sont pas réécrits automatiquement.

Les événements concernent l’aventure normale, hors zones, événements, Ligue Élite
et Tour. Ils suivent les sauvegardes natives du jeu, avec jusqu’à quelques secondes
de délai ; ils ne rejouent pas l’historique au chargement. `onChapterStarted` signale
un changement ou un redémarrage du parcours ; `onChapterFinished` signale son
achèvement, avant le début du suivant. Quitter manuellement un chapitre ne le
termine pas. `onBattleFinished` signale le passage d’un nœud de combat et fournit
son index `node` et l’identifiant d’espèce `roamer` si le nœud contient un errant.
Il ne garantit ni une victoire ni une capture. Les détails d’un combat abandonné
par changement de route ne sont pas émis. Éviter de changer de route sans condition
dans `onChapterStarted`, ce qui créerait une boucle.

Le code s’exécute dans la page du jeu, avec accès à sa sauvegarde et à sa session :
exécuter uniquement du code de confiance. Il n’est pas isolé ni exécuté dans le
service d’arrière-plan de l’extension. Une politique CSP du site interdisant
l’évaluation dynamique peut empêcher son exécution ; l’erreur est affichée.
Une différence de version du moteur n’empêche pas l’utilisation de cette API.

```sh
node --test tests/automation.test.cjs
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright GAME_URL=http://127.0.0.1:8087/ node tests/automation.browser.cjs
GAME_DIR=/chemin/game node tests/firefox.test.cjs
```

## Sélection multiple dans le PC

Dans **Équipe/PC**, utiliser **Ctrl + clic** (ou **Cmd + clic** sur Mac) pour
sélectionner ou désélectionner des Pokémon. Maintenir **Ctrl/Cmd + clic gauche**
et balayer le PC pour inverser la sélection de chaque Pokémon survolé, une seule
fois par geste. Relâcher Ctrl/Cmd arrête la sélection par balayage.
Glisser un Pokémon sélectionné sans modificateur pour
déplacer tout le groupe dans le PC, en conservant son ordre. Le repère indique
l’insertion avant ou après le Pokémon survolé. **Échap** annule le drag et efface
la sélection ; le bouton **Désélectionner** l’efface aussi.

Comme pour le rangement natif, retirer les filtres avant de réorganiser le PC.
Le déplacement passe par les contrôles du jeu, qui conserve la gestion de la
sauvegarde. Les transferts vers l’équipe et les gestes tactiles restent natifs.
Le clavier permet aussi de sélectionner avec **Ctrl/Cmd + Espace**, puis d’ouvrir
une fiche avec **Entrée**.

```sh
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright GAME_URL=http://127.0.0.1:8080/ node tests/pc-multiselect.browser.cjs
GAME_DIR=/chemin/game node tests/firefox.test.cjs
```

Les tests couvrent les déplacements groupés dans les deux sens, une collection
virtualisée de 260 Pokémon, le tri natif, l’annulation et la conservation des
Pokémon et de l’équipe. La capture Chrome est `artifacts/pc-multiselect.png`
(1920 × 1080).

## Ponte à la Pension

Le temps restant avant le prochain œuf apparaît sous la jauge du Métamorph,
y compris sur mobile. Il reprend le délai et la langue de l’infobulle du jeu
et suit les mises à jour de la Pension, sans modifier la sauvegarde.

## Pokédex des amis

Dans **Amis**, ouvrir la carte d’un ami accepté puis cliquer sur l’icône **Pokédex**
à côté de son nom. La fenêtre reprend les régions, les barres de
progression et les tuiles du Pokédex du jeu. Les espèces capturées apparaissent
en couleur, les manquantes en gris. La recherche par nom ou numéro permet de parcourir sa collection.
Échap ou la croix ferment la fenêtre et ramènent à la carte d’ami. Les noms,
types et régions utilisent les données embarquées ; les images et styles viennent du jeu.

La consultation utilise la session de connexion du jeu et sa propre API
`friend_card`, sans serveur supplémentaire ni installation chez l’ami. Elle
reflète sa dernière sauvegarde en ligne, pas nécessairement sa partie actuelle.
L’API de carte ne fournit pas la liste détaillée des chromatiques : ce filtre
n’est donc pas proposé. Aucune sauvegarde ni relation d’amitié n’est modifiée.
Une session absente ou expirée et les erreurs réseau sont affichées dans la
fenêtre, avec un bouton pour réessayer. La session n’est ni copiée dans le
stockage de l’extension ni transmise ailleurs qu’à l’API du jeu.

```sh
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright node tests/friend-dex.browser.cjs
```

Ce test charge réellement l’extension avec une réponse API contrôlée et une
session fictive. Il vérifie le bouton dans la carte d’ami, les grilles de régions,
la recherche, l’absence de filtres, le clavier, le mobile, les thèmes, les erreurs et
l’absence d’écriture dans la sauvegarde. Les captures
1920 × 1080 sont enregistrées dans `artifacts/friend-dex-dark.png` et
`artifacts/friend-dex-light.png`, ainsi que `artifacts/friend-card-pokedex.png`.
La réponse avec un vrai compte reste à vérifier.

## Aperçu des dresseurs

Dans **Progression**, sélectionner un chapitre puis déplier **Dresseurs et équipes**.
La liste montre les dresseurs de route (regroupés par lieu, avec leur nombre),
les assistants d’arène, les dresseurs nommés et les champions dans l’ordre du parcours.
Survoler un dresseur ou lui donner le focus au clavier pour ouvrir son équipe ;
sur mobile, toucher sa ligne. Échap, un second toucher ou un toucher extérieur ferme
l’infobulle. Les longues listes de Pokémon peuvent défiler, y compris au clavier.

Les équipes fixes affichent leurs Pokémon et niveaux exacts, doublons conservés.
Pour les combats aléatoires, l’infobulle affiche les Pokémon possibles, leurs plages
de niveaux et le nombre de Pokémon par combat. Les possibilités couvrent les phases
du jour, les météos du lieu et les évolutions natives ; elles ne prédisent pas le
prochain tirage ni ses probabilités. Les portraits de ces lignes illustrent des classes
possibles, pas des dresseurs déjà sélectionnés.
Les chapitres verrouillés et la fiche groupée de la Ligue n’affichent pas cet aperçu.
Aucune action ne modifie la sauvegarde.

Les données d’aperçu sont indépendantes du moteur de simulation : elles viennent
du bundle officiel `app.c0081498f2.js` consulté le 16 novembre 2026.
Un avertissement apparaît si le jeu utilise un autre bundle.
Pour actualiser ces données depuis un bundle original téléchargé :

```sh
node tools/build_chapter_preview.cjs /chemin/app.<hash>.js
GAME_PREVIEW_BUNDLE=/chemin/app.<hash>.js npm run test:preview
```

Le générateur utilise les fonctions natives de rencontres, d’assistants d’arène,
d’évolution et de calcul des niveaux dans un environnement isolé, pendant la construction. L’extension ne télécharge ni n’exécute de code du
jeu à l’exécution. Pour vérifier les interactions et l’affichage sur le site actuel :

```sh
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright node tests/chapter-preview.browser.cjs
```

Ce test utilise un profil temporaire et une sauvegarde synthétique. Il vérifie
les chapitres verrouillés, la navigation, le survol, le défilement au clavier,
les thèmes clair/sombre, le toucher mobile et l’absence d’écriture par l’aperçu ; les captures de bureau
1920 × 1080 sont enregistrées dans `artifacts/`.

## XP/h des chapitres

La fiche d’un chapitre accessible affiche aussi **XP/h**, y compris sans champion
d’arène. Le calcul utilise 20 parcours indépendants avec l’équipe actuellement en
route, soignée au départ de chaque parcours. Les combats sauvages et dresseurs,
soins, défaites et gains de niveaux pendant le parcours passent par le moteur du
jeu. Les captures ne changent pas la composition évaluée. Pour la Ligue, le
résultat couvre le circuit entier, avec ses retours au départ en cas de défaite.
Les fiches natives des ligues de chaque région affichent ce rendement. Les zones
légendaires affichent aussi l’XP/h, calculée avec leur équipe dédiée (ou l’équipe
d’aventure par défaut). Les chasses événementielles, raids et la Tour n’accordent
pas d’XP de combat et n’affichent donc pas cet indicateur.

Le nombre affiché additionne l’XP de combat de tous les membres de l’équipe,
puis la rapporte à la durée cumulée des parcours, défaites comprises. Il utilise
la cadence nominale du jeu (`ACTION_MS = 2800`) divisée par la vitesse effective
du moteur : ×1, ×2 et ×2,5 pour les réglages ×1, ×2 et ×4. Les animations et les
pauses du joueur ont une durée variable et ne sont pas chronométrées ; le symbole
**≈** rappelle cette limite. Il s’agit du rendement en ligne,
pas de l’XP hors ligne, et les Pokémon au plafond ne gagnent plus d’XP.

L’XP/h et les chances de victoire sont calculées une seule fois à l’ouverture de
la fiche du chapitre, avec la même copie de la sauvegarde. Les gains d’XP, le
butin, les captures, les changements de vitesse ou le temps écoulé ne relancent
aucun calcul tant que la fiche reste ouverte. Fermer puis rouvrir la fiche, ou
consulter un autre chapitre puis revenir, lance une nouvelle estimation.
Les choix de cadeaux et d’échanges sont ignorés dans la simulation, sans accorder de récompense ni changer
l’équipe évaluée. Une évolution demandant un choix affiche « Indisponible » avec sa raison au survol
ou au clavier. Une version différente du moteur affiche seulement un avertissement
dans le tooltip : les calculs et les actions restent disponibles.
Aucune simulation ne modifie la sauvegarde.

```sh
node --test tests/chapter-xp.test.cjs
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright GAME_DIR=/chemin/game node tests/chapter-xp.browser.cjs
```

Les lecteurs de l’extension acceptent les sauvegardes historiques et le format
compact `SaveWire` (`fmt: 2`) du jeu actuel, sans réécrire le stockage.
Après téléchargement du frontend actuel et lancement de sa copie locale, vérifier
le décodage natif, l’XP/h, l’arène, la recherche et l’application d’équipe avec :

```sh
GAME_SAVE_BUNDLE=/chemin/game/bundle/app.<hash>.js node --test tests/save-reader.test.cjs
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright GAME_URL=http://127.0.0.1:8080/ GAME_SAVE_BUNDLE=/chemin/game/bundle/app.<hash>.js node tests/current-game.browser.cjs
```

Ce test bloque les API de comptes, utilise une sauvegarde de test encodée par le
frontend téléchargé et produit `artifacts/current-game-save-fixed.png` (1920 × 1080).

## Ce que mesure le résultat de victoire

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

La lecture porte sur la dernière sauvegarde automatique du jeu au moment de
l’ouverture de la fiche. Les PV et statuts actuels sont ignorés puisque l’équipe
part soignée. Un rafraîchissement visuel de la fiche conserve les résultats de
cette visite ; un changement de chapitre ou une fermeture suivie d’une réouverture
lance un nouveau calcul. Revenir à l’onglet du navigateur ne relance pas le calcul.
Un retour via Précédent/Suivant après avoir quitté la page constitue une nouvelle
visite. Les chapitres sans champion d’arène peuvent afficher les duels des rencontres fixes et des dresseurs nommés décrits ci-dessous.

## Rencontres spéciales

Le moteur embarqué vient du bundle officiel `app.c0081498f2.js` (build `b05c8cc201`),
récupéré le 4 novembre 2026. Une différence de version reste un simple avertissement.

- **Zones légendaires** : dans Progression, ouvrir la fiche du légendaire, par exemple
  Électhor à la Centrale. Le résultat utilise l’équipe dédiée à cette zone, ou l’équipe
  d’aventure si elle est vide, soignée et plafonnée au niveau du boss. Les bonus de PV,
  la rage, les ripostes, la météo et les formes hebdomadaires viennent du moteur natif.
- **Événements** : la fiche d’une chasse ouverte utilise son équipe d’événement et
  respecte la limite de fuite du légendaire. Les événements désactivés ou terminés
  restent indisponibles pour une raison réelle du jeu.
- **Rencontres fixes et dresseurs nommés** : le sélecteur Rencontre (sous Autres rencontres si le chapitre a aussi une arène)
  permet d’estimer chaque duel, dont Ronflex, le fantôme d’Ossatueur et les Kimono.
- **Ligue** : choisir un adversaire individuel ou Ligue entière. Le circuit comprend
  les combats intermédiaires et les soins natifs ; sa première défaite compte comme un échec.
- **Raids** : après avoir rejoint un raid, revenir à sa fiche dans Raids. Le duel du boss
  utilise les Pokémon du joueur et les alliés enregistrés avec leurs véritables statistiques,
  tous soignés. Avant de rejoindre le raid, les statistiques des amis ne sont pas entièrement
  présentes dans la sauvegarde : aucun allié n’est inventé.
- **Tour** : la fiche Tour de Combat estime le prochain étage avec les Pokémon encore
  disponibles dans la run, leurs PV et statuts conservés. Sans run, elle estime le premier
  étage d’une nouvelle run. Il ne s’agit pas d’une estimation de l’étage maximal.

Hors circuit de Ligue, ces résultats mesurent un **duel direct**, sans le trajet précédent.
Une capture ratée après le K.O. du boss reste une victoire au combat. Aucun pourcentage
n’est proposé pour le bouclier du boss mondial : son état et son issue dépendent du serveur.

La recherche d’équipe est aussi disponible pour les zones, événements, duels du chapitre et la Ligue entière.
Pour la Ligue, chaque composition est évaluée sur le circuit complet, jusqu’au dernier champion.
La proposition s’applique à l’équipe d’aventure via le PC.
Appliquer une proposition de zone ou d’événement utilise le sélecteur natif de cette équipe,
avec restauration de la composition précédente en cas d’échec. L’équipe d’aventure reste
séparée. Les simulations ne modifient pas la sauvegarde ; seule cette action explicite
change la composition dédiée. Les raids et la Tour affichent
l’estimation sans proposer de réorganiser leurs équipes.

Les résultats sont conservés pendant la visite de la fiche. Changer de rencontre,
fermer puis rouvrir la fiche, ou appliquer une proposition lance une nouvelle estimation.

```sh
GAME_BUNDLE=/chemin/app.c0081498f2.js node --test tests/simulator.test.cjs tests/optimizer.test.cjs tests/chapter-xp.test.cjs tests/encounters.test.cjs
PLAYWRIGHT_MODULE=/chemin/node_modules/playwright GAME_DIR=/chemin/game node tests/encounters.browser.cjs
```

Le contrôle navigateur charge l’extension et le vrai jeu dans un profil temporaire,
vérifie Électhor, l’optimisation et l’application native de son équipe, les rencontres
fixes, la Ligue, les thèmes, le petit écran et l’avertissement de version. Les captures
1920 × 1080 sont enregistrées dans `artifacts/electhor-dark.png`, `artifacts/electhor-light.png`
et `artifacts/encounter-ronflex.png`. `KEEP_OPEN=1` conserve le navigateur et le serveur local.

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
que le champion change. Les scripts utilisateur sont stockés localement ; aucun script n’est téléchargé.

## Releases

Chaque push sur `main` lance le contrôle des types, la compilation et la publication
d’une release avec `pokevin.zip` en pièce jointe. Le tag et le manifeste du ZIP
reçoivent une version à quatre nombres : `v0.4.6.1`, `v0.4.6.2`, etc. Les trois
premiers viennent de `manifest.json`, le dernier est le numéro d’exécution du workflow.
La release cible le commit du push ; aucun commit de version n’est ajouté au dépôt.
Aucun tag ni release n’est à créer manuellement ; les releases manuelles ne déclenchent rien.

L’archive contient les fichiers nécessaires à l’exécution et les mentions légales,
sans les dépendances de développement ni les tests. Une relance de l’action remplace
le ZIP existant. Aucun secret à configurer.

## Reproduction et vérification

Depuis la racine du dépôt, avec Python 3 et Node 18 ou ultérieur :

```powershell
python tools/build_extension_engine.py /chemin/app.c0081498f2.js --build b05c8cc201
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
npm run typecheck
npm run build:extension
```

Le JavaScript et les composants JSX maintenus sont vérifiés en mode strict avec
`@ts-check` et des annotations JSDoc. `types/domain.d.ts` décrit les sauvegardes,
les résultats, les messages et la surface du moteur utilisée par l’extension.
`npm run typecheck` vérifie ces contrats sans produire de fichiers. Le moteur,
les données et le bundle UI générés sont exclus du contrôle ; les sources JSX
sont contrôlées avant leur compilation. Les dépendances de types servent au
développement uniquement.

Les versions de React et d’esbuild sont verrouillées par `package-lock.json`.
Node n’est nécessaire que pour développer ou reconstruire l’extension.

Le générateur recopie trois tranches **sans réécriture** du bundle du jeu :
données, règles d’environnement/Pokémon/progression/aventure, puis modules
événements/raids/Tour/zones légendaires/itinérants. Seuls
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
l’absence d’écriture dans la sauvegarde, la stabilité du résultat après un gain
de niveau, le calcul unique par visite, la navigation rapide entre champions et l’avertissement de
version sans blocage du calcul. Il vérifie ensuite l’emplacement et la navigation dans la vraie copie
locale du jeu, y compris sur petit écran, ainsi qu’une vraie restauration du
cache de navigation après modification de la sauvegarde. Il ne lit pas le
profil du joueur.

Le code et les données du jeu restent la propriété de leurs auteurs. Copie
destinée à cet usage personnel ; aucune publication de l’extension n’a été faite.
