// @ts-check
/* Adapter around the copied engine. This file never reads or writes game storage. */
(() => {
  'use strict';
  const engine = globalThis.PokeCatchEngine;
  const { Game, Adventure, STORY, CONFIG } = engine;
  /** @template T @param {T} value @returns {T} */
  const clone = value => structuredClone(value);
  const initiallyOpen = new Set(STORY.REGIONS.filter(region => region.open).map(region => region.key));

  /** @param {import("./types/domain").Save} save */
  function restoreRegions(save) {
    for (const region of STORY.REGIONS) {
      if (region.key) region.open = initiallyOpen.has(region.key) || !!save.travel?.to?.includes(region.key);
    }
  }

  /** @param {import("./types/domain").Save} save */
  function validateSave(save, allowSpecial = false) {
    if (!save || save.v !== 2 || !Array.isArray(save.mons) || !Array.isArray(save.team) ||
        !save.adv || !Number.isInteger(save.adv.chapter) || !STORY.CHAPTERS[save.adv.chapter]) {
      throw new Error('Sauvegarde absente ou incompatible. Lance une partie avant de la lire.');
    }
    if (!allowSpecial && (save.adv.event || save.adv.zone || save.adv.tower)) {
      throw new Error("Reviens à l’aventure normale pour lire ton équipe en route.");
    }
    if (save.adv.layout !== 6) {
      throw new Error('Cette sauvegarde doit être actualisée : ouvre le jeu, attends sa sauvegarde, puis relis ton équipe.');
    }
  }

  /** @param {import("./types/domain").Save} save @returns {import("./types/domain").Champion[]} */
  function champions(save) {
    validateSave(save);
    const region = STORY.regionOf(save.adv.chapter);
    return STORY.CHAPTERS.flatMap((chapter, chapterIndex) => {
      if (chapter.league || STORY.regionOf(chapterIndex).key !== region.key) return [];
      return chapter.steps.flatMap((gym, stepIndex) => gym.kind === 'gym' && gym.badge ? [{
        id: `${chapterIndex}:${stepIndex}`, chapter: chapterIndex,
        name: gym.leader, badge: gym.badge, region: region.name,
        chapterName: chapter.name,
        enemies: STORY.gymTeam(chapterIndex, gym).map(([id, level]) => ({
          id, name: Game.DEX[id].name, level,
        })),
      }] : []);
    });
  }

  /** @param {import("./types/domain").Mon} mon */
  function validMon(mon) {
    return !!mon && !!Game.DEX[mon.id] && Number.isInteger(mon.level) && mon.level >= 1 &&
      mon.level <= CONFIG.MAX_LEVEL && Number.isFinite(mon.xp) && mon.xp >= 0 &&
      (mon.rank == null || (Number.isInteger(mon.rank) && mon.rank >= 0 && mon.rank <= CONFIG.UNDERGROUND.RANK_MAX));
  }

  /** @param {import("./types/domain").Save} save */
  function available(save) {
    validateSave(save);
    restoreRegions(save);
    const state = Object.assign(Game.freshState(), clone(save));
    return Game.sandbox(state, () => state.mons.filter(mon => validMon(mon) && !Game.can(mon))
      .map(mon => ({ uid: mon.uid, group: Game.beingOf(mon) })));
  }

  /** @param {import("./types/domain").Save} save @param {number} [now] @param {string[]} [teamIds] @param {boolean} [allowSpecial] @returns {import("./types/domain").PreparedTeam} */
  function prepareTeam(save, now = Date.now(), teamIds, allowSpecial = false) {
    validateSave(save, allowSpecial);
    if (!Number.isFinite(now)) throw new Error('Date de simulation invalide.');
    engine.setSnapshotTime(now);
    // Same regional flags restored by Game.load in the real game.
    restoreRegions(save);
    const state = Object.assign(Game.freshState(), clone(save));
    state.stats = { ...Game.freshState().stats, ...state.stats };
    state.buddy = Object.assign({ uid: null, ko: 0 }, state.buddy);
    state.trainer ||= {};
    state.items ||= {};
    state.dex ||= {};
    state.seen ||= {};
    state.seenShiny ||= {};
    state.eventTeams ||= {};
    const team = teamIds ?? (Array.isArray(state.road) && state.road.length ? state.road : state.team);
    if (!team.length || team.length > CONFIG.TEAM_SIZE || new Set(team).size !== team.length) {
      throw new Error('Il faut une équipe en route de 1 à 6 Pokémon différents.');
    }
    const mons = team.map(uid => {
      const matches = state.mons.filter(mon => mon.uid === uid);
      if (matches.length !== 1) throw new Error('Un Pokémon de l’équipe est introuvable.');
      const mon = matches[0];
      if (!validMon(mon)) {
        throw new Error('Les données d’un Pokémon ne sont pas compatibles avec ce moteur.');
      }
      return mon;
    });
    state.team = [...team];
    state.road = [...team];
    state.adv.badges ||= [];
    state.adv.gifts ||= {};
    state.adv.kept ||= {};
    /** @type {import("./types/domain").TeamMon[]} */
    let teamSummary = [];
    Game.sandbox(state, () => {
      for (const mon of mons) {
        const reason = state.adv.zone ? Game.can(mon, 'zone', state.adv.zone.id) :
          state.adv.event ? null : Game.can(mon);
        if (reason) throw new Error(reason);
      }
      if (new Set(mons.map(mon => Game.beingOf(mon))).size !== mons.length) {
        throw new Error('Cette composition contient des doublons interdits par le jeu.');
      }
      Game.healTeam();
      teamSummary = Game.teamMons().map(mon => ({
        uid: mon.uid, id: mon.id, name: Game.DEX[mon.id].name,
        level: Game.lvl(mon), shiny: !!mon.shiny, rank: Game.rankOf(mon),
        hp: Game.maxHp(mon),
      }));
    });
    return {
      state, team: teamSummary, now,
      autoSwitch: state.autoSwitch !== false,
      pendingTeam: Array.isArray(save.road) && save.road.length > 0 &&
        JSON.stringify(save.road) !== JSON.stringify(save.team),
    };
  }

  /** @param {import("./types/domain").Save} save @param {string} championId @param {number} [now] @param {string[]} [teamIds] @returns {import("./types/domain").PreparedFight} */
  function prepare(save, championId, now = Date.now(), teamIds) {
    const champion = champions(save).find(item => item.id === championId);
    if (!champion) throw new Error('Choisis un champion de ta région actuelle.');
    const prepared = prepareTeam(save, now, teamIds);
    const { state } = prepared;
    const [chapterIndex, stepIndex] = champion.id.split(':').map(Number);
    const gym = clone(STORY.CHAPTERS[chapterIndex].steps[stepIndex]);
    Object.assign(state.adv, {
      chapter: chapterIndex, nodes: [{ ...gym, ch: chapterIndex, type: 'gym', gym }],
      node: 0, battle: null, pending: null, event: null, zone: null, tower: null,
      capture: { on: false }, loops: [],
    });
    return { ...prepared, champion };
  }

  /** @param {import("./types/domain").PreparedFight} prepared @param {import("./types/domain").CombatEvent[] | null} [trace] @param {number} [seed] */
  function fight(prepared, trace, seed) {
    const random = Math.random;
    if (seed !== undefined) {
      let value = seed >>> 0;
      Math.random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
    }
    try { return runFight(prepared, trace); }
    finally { Math.random = random; }
  }

  /** @param {import("./types/domain").PreparedFight} prepared @param {import("./types/domain").CombatEvent[] | null} [trace] */
  function runFight(prepared, trace) {
    // Every trial starts with a fresh copy, including XP, buffs and progression.
    const state = clone(prepared.state);
    engine.setSnapshotTime(prepared.now);
    // Several game tabs may interleave batches in the extension's background service.
    restoreRegions(state);
    return Game.sandbox(state, () => {
      let enemies;
      for (let actions = 1; actions <= 20000; actions++) {
        const events = Adventure.step();
        enemies ||= state.adv.battle?.enemies;
        if (trace) trace.push(...clone(events));
        applyEvolutions(events);
        if (events.some(event => event.type === 'victory' && event.kind === 'gym')) {
          return { won: true, progress: 1, actions, survivors: Game.teamMons().filter(mon => Game.curHp(mon) > 0).length };
        }
        // A previously beaten leader lets a defeated team pass: that is still a loss here.
        if (events.some(event => event.type === 'defeat' || event.type === 'skip')) {
          const progress = enemies ? enemies.reduce((sum, mon) => sum + 1 - Game.curHp(mon) / Game.maxHp(mon), 0) / enemies.length : 0;
          return { won: false, progress, actions, survivors: 0 };
        }
        if (!state.adv.battle) throw new Error('Le combat s’est interrompu sans résultat.');
      }
      throw new Error('La simulation a dépassé sa limite d’actions. Aucun résultat estimé.');
    });
  }

  // The live UI applies these effects after each engine action.
  /** @param {import("./types/domain").CombatEvent[]} events @param {boolean} [requireChoice] */
  function applyEvolutions(events, requireChoice = false) {
    for (const event of events) {
      const gains = event.type === 'xp' ? [event] : event.type === 'buddyCandy' ? event.fed || [] : event.candy?.fed || [];
      for (const gain of gains) {
        const evolution = gain.evolve;
        if (!evolution) continue;
        const mon = Game.getMon(evolution.uid);
        if (!mon || mon.id !== evolution.from || Game.evoBlocked(mon, evolution.to)) continue;
        if (!evolution.forced && Game.levelEvolutions(mon).length > 1) {
          if (requireChoice || Game.S.adv.battle) throw Object.assign(new Error('Une évolution nécessite un choix du joueur avant de poursuivre cette estimation.'), { code: 'EVOLUTION_CHOICE' });
          continue; // A choice after the final KO cannot change the fight's outcome.
        }
        Game.evolveMon(evolution.uid, evolution.to);
      }
    }
  }

  /** @param {number} wins @param {number} runs */
  function interval(wins, runs) {
    if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(wins) || wins < 0 || wins > runs) {
      throw new Error('Résultat statistique invalide.');
    }
    const z = 1.959963984540054, p = wins / runs, d = 1 + z * z / runs;
    const center = (p + z * z / (2 * runs)) / d;
    const margin = z * Math.sqrt(p * (1 - p) / runs + z * z / (4 * runs * runs)) / d;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
  }

  globalThis.GymSimulator = { validateSave, validMon, restoreRegions, champions, available, prepareTeam, prepare, fight, applyEvolutions, interval };
})();
