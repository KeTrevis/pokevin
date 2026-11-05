// @ts-check
/* Chapter farming estimates run only on sandboxed copies of the save. */
(() => {
  'use strict';
  const { Game, Adventure, STORY, CONFIG, setSnapshotTime } = PokeCatchEngine;
  const RUNS = 20;

  /** @param {import("./types/domain").Save} save @param {import("./types/domain").XPTarget} target @param {number} [now] @returns {Generator<import("./types/domain").Progress, import("./types/domain").XPResult, unknown>} */
  function* estimate(save, target, now = Date.now()) {
    const zone = typeof target === 'string' && /^zone:\d+$/.test(target);
    const chapter = typeof target === 'number' ? target :
      zone ? save.adv.chapter : STORY.CHAPTERS.findIndex((entry, index) =>
        entry.league && target === `league:${STORY.regionOf(index).key}`);
    const prepared = zone ? EncounterSimulator.prepare(save, String(target), now) : GymSimulator.prepareTeam(save, now);
    if (!Number.isInteger(chapter) || !STORY.CHAPTERS[chapter] ||
        chapter > (save.adv.unlocked ?? save.adv.chapter) ||
        STORY.regionOf(chapter).key !== STORY.regionOf(save.adv.chapter).key) {
      throw new Error('Choisis un chapitre accessible de ta région actuelle.');
    }
    // League chapters form one continuous loop, including shared defeat resets.
    const circuit = !zone && STORY.leagueOf(chapter) || [chapter];
    const teamIds = prepared.team.map(mon => mon.uid);
    let xp = 0, elapsedMs = 0, completed = 0, defeats = 0, speed = 1;
    for (let run = 0; run < RUNS; run++) {
      const state = structuredClone(prepared.state);
      if (!zone) Object.assign(state.adv, { chapter: circuit[0], nodes: [], node: 0, battle: null,
        pending: null, event: null, zone: null, tower: null, kept: {},
        loops: [Adventure.loopKey(chapter)], paused: false });
      let trialMs = 0, finished = false;
      setSnapshotTime(now);
      GymSimulator.restoreRegions(state);
      Game.sandbox(state, () => {
        if (!zone) Adventure.buildChapter(circuit[0]);
        speed = Adventure.speed();
      });
      for (let actions = 1; actions <= 20000; actions++) {
        // Each sandbox slice restores the snapshot's regional flags for interleaved tabs.
        setSnapshotTime(now + trialMs);
        const events = Game.sandbox(state, () => {
          GymSimulator.restoreRegions(state);
          // Optional gifts/trades do not affect combat XP with the current team.
          // Skip their choices only in this copy, without granting their rewards.
          while (!state.adv.battle && !state.adv.pending &&
              state.adv.nodes[state.adv.node]?.type === 'gift') state.adv.node++;
          const events = Adventure.step();
          GymSimulator.applyEvolutions(events, true);
          // Captures may fill empty team slots; keep estimating the selected team.
          state.team = [...teamIds];
          state.road = [...teamIds];
          return events;
        });
        // Nominal live action cadence; animation and player interaction time varies.
        const duration = CONFIG.ACTION_MS / speed;
        trialMs += duration;
        elapsedMs += duration;
        for (const event of events) {
          if (event.type === 'xp' && event.uid && teamIds.includes(event.uid)) xp += event.amount ?? 0;
          if (['gift', 'waiting', 'noTeam'].includes(event.type)) {
            throw new Error('Termine les choix de ce chapitre dans le jeu avant d’estimer son XP/h.');
          }
          if (event.type === 'defeat' || zone && ['zoneOver', 'fled', 'skip'].includes(event.type)) { defeats++; finished = true; }
          if (zone ? event.type === 'victory' : event.type === 'chapterEnd' && event.chapter === circuit.at(-1)) {
            completed++; finished = true;
          }
        }
        if (finished) break;
        if (actions === 20000) throw new Error('Le chapitre a dépassé la limite de simulation.');
        if (actions % 64 === 0) yield { done: run, runs: RUNS };
      }
      yield { done: run + 1, runs: RUNS };
    }
    return { xpPerHour: xp * 3600000 / elapsedMs, xp, elapsedMs, runs: RUNS,
      completed, defeats, speed, league: circuit.length > 1, now };
  }

  globalThis.ChapterXP = { estimate };
})();
