// @ts-check
/* Search only copied states. Never equip, move, train or evolve a real Pokémon. */
(() => {
  'use strict';
  const { Game, Adventure } = PokeCatchEngine;
  const SCREEN_RUNS = 12;
  const FINAL_RUNS = 100;
  /** @typedef {{ team: string[], wins: number, progress: number, survivors: number, actions: number, runs: number }} Score */
  /** @param {Score} a @param {Score} b */
  const compare = (a, b) => a.wins - b.wins || a.progress - b.progress || a.survivors - b.survivors || b.actions - a.actions;

  /** @param {import("./types/domain").Save} save @param {string} championId @param {number} [now] @returns {Generator<import("./types/domain").OptimizationProgress, import("./types/domain").OptimizationResult, unknown>} */
  function* search(save, championId, now = Date.now()) {
    const special = /^(zone|event|story):/.test(championId);
    const sim = special ? EncounterSimulator : GymSimulator;
    const roster = special ? EncounterSimulator.available(save, championId) : GymSimulator.available(save);
    if (!roster.length) throw new Error('Aucun Pokémon disponible dans ton équipe et ton PC.');
    const groups = new Map(roster.map(mon => [mon.uid, mon.group]));
    /** @param {string[]} team */
    const legal = team => team.length > 0 && team.length <= 6 && team.every(uid => groups.has(uid)) &&
      new Set(team.map(uid => groups.get(uid))).size === team.length;
    const seedTeam = sim.prepare(save, championId, now, [roster[0].uid]);
    const ranked = Game.sandbox(seedTeam.state, () => {
      const enemies = seedTeam.champion.enemies.map(mon => ({
        ...Game.makeMon(mon.id, mon.level, { shiny: false }), foe: true,
      }));
      return roster.map(mon => {
        const owned = Game.getMon(mon.uid);
        const scores = enemies.map(enemy => Adventure.counterValue(owned, enemy, Game.lvl(owned)));
        return { ...mon, scores, score: scores.reduce((sum, score) => sum + score, 0) / scores.length };
      });
    });
    const current = special ? EncounterSimulator.team(save, championId) :
      [...(save.road?.length ? save.road : save.team)];
    const pool = new Set(legal(current) ? current : []);
    /** @template {{ uid: string, group: string }} T @param {T[]} list @param {(mon: T) => number} score @param {number} count */
    const addBest = (list, score, count) => {
      const used = new Set();
      for (const mon of [...list].sort((a, b) => score(b) - score(a))) {
        if (used.has(mon.group)) continue;
        used.add(mon.group); pool.add(mon.uid);
        if (used.size >= count) break;
      }
    };
    // Use the native matchup score only to shortlist; all team comparisons play real fights.
    addBest(ranked, mon => mon.score, 18);
    for (let i = 0; i < ranked[0].scores.length; i++) addBest(ranked, mon => mon.scores[i], 3);
    const candidates = [...pool];
    const teamSize = Math.min(6, new Set(roster.map(mon => mon.group)).size);
    /** @type {Map<string, Score | null>} */
    const memo = new Map();
    let tested = 0, trials = 0;

    /** @param {string[]} team @param {number} runs @param {number} phase @returns {Generator<import("./types/domain").OptimizationProgress, Score | null, unknown>} */
    function* evaluate(team, runs, phase) {
      const key = JSON.stringify([phase, team]);
      if (memo.has(key)) return memo.get(key) ?? null;
      const prepared = sim.prepare(save, championId, now, team);
      const result = { team: [...team], wins: 0, progress: 0, survivors: 0, actions: 0, runs };
      for (let i = 0; i < runs; i++) {
        let fight;
        try { fight = sim.fight(prepared, null, ((now >>> 0) + Math.imul(i + 1, 2654435761) + phase * 1013904223) >>> 0); }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'EVOLUTION_CHOICE') throw error;
          memo.set(key, null); return null;
        }
        result.wins += +fight.won; result.progress += fight.progress;
        result.survivors += fight.survivors; result.actions += fight.actions;
        trials++;
        yield { stage: phase ? 'validation' : 'search', teams: tested, trials, candidates: roster.length };
      }
      tested++;
      memo.set(key, result);
      return result;
    }

    /** @type {Score[]} */
    const screened = [];
    /** @param {string[]} team @returns {Generator<import("./types/domain").OptimizationProgress, Score | null, unknown>} */
    function* screen(team) {
      if (!legal(team)) return null;
      const result = yield* evaluate(team, SCREEN_RUNS, 0);
      if (result && !screened.includes(result)) screened.push(result);
      return result;
    }

    if (legal(current)) yield* screen(current);
    /** @type {string[]} */
    let greedy = [];
    for (let slot = 0; slot < teamSize; slot++) {
      /** @type {Score | undefined} */
      let best;
      for (const uid of candidates) {
        const result = yield* screen([...greedy, uid]);
        if (result && (!best || compare(result, best) > 0)) best = result;
      }
      if (!best) break;
      greedy = best.team;
    }
    if (!screened.length) throw new Error('Les compositions testées nécessitent un choix d’évolution. Termine ce choix dans le jeu avant de relancer.');
    let best = [...screened].sort((a, b) => compare(b, a))[0];
    // shortcut: bounded shortlist + two replacement passes, not a proof of the global optimum.
    // Expand the search only if the measured gains justify longer calculations.
    for (let pass = 0; pass < 2; pass++) {
      const previous = best;
      for (let slot = 0; slot < previous.team.length; slot++) {
        for (const uid of candidates) {
          const team = [...previous.team]; team[slot] = uid;
          const result = yield* screen(team);
          if (result && compare(result, best) > 0) best = result;
        }
      }
      if (best === previous) break;
    }
    const order = [...best.team];
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const team = [...order]; [team[i], team[j]] = [team[j], team[i]];
      yield* screen(team);
    }

    // Fresh trials prevent ranking solely on the random draws used during the search.
    const baseline = legal(current) ? yield* evaluate(current, FINAL_RUNS, 1) : null;
    let winner = baseline;
    const finalists = [...screened].sort((a, b) => compare(b, a)).slice(0, 4);
    for (const finalist of finalists) {
      const validated = yield* evaluate(finalist.team, FINAL_RUNS, 1);
      if (validated && (!winner || validated.wins > winner.wins ||
          (winner !== baseline && compare(validated, winner) > 0))) winner = validated;
    }
    if (!winner) throw new Error('Aucune estimation fiable n’a pu être obtenue.');
    const prepared = sim.prepare(save, championId, now, winner.team);
    return {
      champion: prepared.champion.name, team: prepared.team,
      probability: winner.wins / FINAL_RUNS, wins: winner.wins, runs: FINAL_RUNS,
      currentProbability: baseline ? baseline.wins / FINAL_RUNS : null,
      currentWins: baseline?.wins ?? null,
      unchanged: JSON.stringify(winner.team) === JSON.stringify(current),
      available: roster.length, tested, trials, now,
    };
  }

  globalThis.TeamOptimizer = { search };
})();
