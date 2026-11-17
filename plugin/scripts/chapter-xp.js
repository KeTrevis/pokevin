// @ts-check
// The script owns sampling and the XP/h formula; the SDK returns native events.
/**
 * @param {import("../types/adventures").Simulate} simulate
 * @param {import("../types/domain").Save} save
 * @param {import("../types/domain").AdventureTarget} target
 * @param {number} [now]
 * @returns {AsyncGenerator<import("../types/domain").Progress, import("../types/domain").XPResult, unknown>}
 */
globalThis.PokevinChapterXP = async function* (simulate, save, target, now = Date.now()) {
  let xp = 0, elapsedMs = 0, completed = 0, defeats = 0, speed = 1, league = false;
  const RUNS = 20;
  for (let run = 0; run < RUNS; run++) {
    const result = await simulate(save, target, { now });
    for (const event of result.events) {
      if (event.type === 'xp' && event.uid && result.teamIds.includes(event.uid)) xp += event.amount ?? 0;
    }
    elapsedMs += result.elapsedMs;
    completed += +(result.outcome === 'completed');
    defeats += +(result.outcome === 'defeat');
    speed = result.speed; league = result.league;
    yield { done: run + 1, runs: RUNS };
  }
  return { xpPerHour: xp * 3600000 / elapsedMs, xp, elapsedMs, runs: RUNS,
    completed, defeats, speed, league, now };
};
