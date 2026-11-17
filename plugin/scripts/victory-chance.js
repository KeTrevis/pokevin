// @ts-check
// Bundled script: the SDK supplies fights; this script owns the sampling policy.
/** @param {import('../types/battles').Battles} battles
 * @param {import('../types/domain').Save} save
 * @param {string | number} target */
globalThis.PokevinVictoryChance = async function* (battles, save, target) {
  const battle = await battles.prepare(save, target);
  const runs = 100;
  let wins = 0;
  try {
    for (let done = 1; done <= runs; done++) {
      wins += Number((await battle.fight()).won);
      yield { done, runs };
    }
    return { wins, runs, probability: wins / runs,
      interval: await battles.interval(wins, runs), champion: battle.champion.name,
      pendingTeam: battle.pendingTeam, now: battle.now };
  } finally {
    battle.close();
  }
};
