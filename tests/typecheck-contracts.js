// @ts-check
// These expected errors also fail typecheck if an API accidentally becomes untyped.
/** @param {import('../types/domain').Save} save @param {HTMLElement} element */
function checkContracts(save, element) {
  // @ts-expect-error A team stores Pokémon UIDs, not Pokédex numbers.
  save.team.push(25);
  // @ts-expect-error Chapter IDs must be numbers.
  ChapterXP.estimate(save, '1');
  // @ts-expect-error Gym IDs are chapter:step strings.
  GymSimulator.prepare(save, 1);
  // @ts-expect-error Badge tones are restricted to the design system.
  PokeCatchUI.updateBadge(element, { tone: 'warning' });
  // @ts-expect-error Applying a proposal requires Pokémon data, not just IDs.
  PokeCatchTeams.apply(['uid-1'], 0);
  /** @type {import('../types/domain').WorkerRequest} */
  const request = { type: 'xp', requestId: 1, chapter: 0, save };
  // @ts-expect-error A simulation request cannot carry a textual chapter ID.
  request.chapter = '0';
}
