// @ts-check
// These expected errors also fail typecheck if an API accidentally becomes untyped.
/** @param {import('../plugin/types/domain').Save} save @param {HTMLElement} element */
function checkContracts(save, element) {
  pokevin.catalog().then(catalog => console.log(catalog.species[0].name));
  pokevin.ui.versionWarning('app.js');
  // @ts-expect-error Version checks use bundle filenames.
  pokevin.ui.versionWarning(123);
  pokevin.simulate(save, 0).then(result => {
    for (const event of result.events) {
      if (event.type === 'item' && event.item) console.log(event.item, event.n ?? 0);
    }
  });
  const { ui, chapters } = PokevinCreateUI(new Set(), () => true);
  ui.observe('#timeline', elements => elements.forEach(node => node.getAttribute('id')));
  // @ts-expect-error Observed DOM elements are typed.
  ui.observe('#timeline', elements => elements[0].fight());
  // @ts-expect-error Badge text must be a string.
  ui.chapterBadge(0, { text: 123 });
  // @ts-expect-error Chapters use numeric IDs or zone/league targets.
  ui.chapterBadge('not-a-chapter', { text: 'XP/h' });
  chapters.onViewed((view, scope) => {
    if (view) scope.ui.chapterBadge(view.chapterId, { text: 'XP/h', color: '#42c978' });
    // @ts-expect-error Visit scopes preserve the typed battle API.
    scope.battles.prepare(save, {});
    // @ts-expect-error Visit scopes preserve the typed badge API.
    scope.ui.chapterBadge(0, { text: 123 });
  });
  // @ts-expect-error Targets are numeric chapters or string encounter IDs.
  PokevinBattleSDK.battles.prepare(save, {});
  PokevinBattleSDK.battles.prepare(save, 0).then(battle => {
    // @ts-expect-error Reproducible seeds must be numeric.
    battle.fight('42');
  });
  // @ts-expect-error A team stores Pokémon UIDs, not Pokédex numbers.
  save.team.push(25);
  // @ts-expect-error Chapter IDs must be numbers.
  pokevin.simulate(save, '1');
  // @ts-expect-error Gym IDs are chapter:step strings.
  GymSimulator.prepare(save, 1);
  // @ts-expect-error Badge tones are restricted to the design system.
  PokeCatchUI.updateBadge(element, { tone: 'warning' });
  // @ts-expect-error Applying a proposal requires Pokémon data, not just IDs.
  PokeCatchTeams.apply(['uid-1'], 0);
  /** @type {import('../plugin/types/domain').WorkerRequest} */
  const request = { type: 'run', requestId: 1, chapter: 0, save };
  // @ts-expect-error A simulation request cannot carry a textual chapter ID.
  request.chapter = '0';
}
