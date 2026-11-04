// @ts-check
/* Direct encounters use native nodes and teams; only copies of the save are touched. */
(() => {
  const engine = PokeCatchEngine;
  const { Game, Adventure, STORY, LegendZones, Events, Raids, Tower } = engine;
  const clone = structuredClone;

  /** @returns {import('./types/domain').Encounter[]} */
  function catalog() {
    const encounters = STORY.CHAPTERS.flatMap((chapter, ch) => chapter.steps.flatMap((step, index) => {
      if (!['static', 'trainer', 'gym'].includes(step.kind)) return [];
      // Badge champions already have their own inline result outside the League.
      if (step.kind === 'gym' && step.badge && !chapter.league) return [];
      return [{ id: `story:${ch}:${index}`, name: step.kind === 'static' ? Game.DEX[step.id].name : step.trainer || step.leader,
        kind: chapter.league ? `league:${STORY.regionOf(ch).key}` : chapter.steps.some(item => item.kind === 'gym' && item.badge) ? 'extra' : 'story', chapter: ch }];
    }));
    for (const [ch, chapter] of STORY.CHAPTERS.entries()) {
      if (chapter.league && STORY.leagueOf(ch)?.[0] === ch) {
        const region = STORY.regionOf(ch).key;
        encounters.push({ id: `league:${region}`, name: 'Ligue entière', kind: `league:${region}`, chapter: ch });
      }
    }
    return encounters;
  }

  /** @param {import('./types/domain').Save} save @param {string} id @param {number} now */
  function context(save, id, now) {
    GymSimulator.validateSave(save, true);
    if (!Number.isFinite(now)) throw new Error('Date de simulation invalide.');
    engine.setSnapshotTime(now);
    GymSimulator.restoreRegions(save);
    const state = Object.assign(Game.freshState(), clone(save));
    state.eventTeams ||= {};
    state.adv = { ...state.adv, event: null, zone: null, tower: null, battle: null, pending: null, loops: [], capture: { on: false } };
    const [kind, value, step] = id.split(':');
    let name = '', teamKey;
    if (kind === 'zone') {
      const zone = LegendZones.get(Number(value));
      if (!zone || zone.wb) throw new Error('Cette zone nécessite un état serveur et ne peut pas être estimée hors ligne.');
      const foe = Game.sandbox(state, () => LegendZones.foe(zone));
      state.adv.zone = { id: zone.id, foe, level: zone.level, back: state.adv.chapter };
      teamKey = `zone:${zone.id}`;
      name = Game.DEX[foe].name;
    } else if (kind === 'event') {
      const legend = Events.legendOf(Number(value));
      if (!legend) throw new Error('Événement inconnu.');
      // Use the saved event when present; never manufacture an open public hunt.
      const event = [state.events?.cur, state.events?.priv].find(event => event?.id === Number(value) && event.end == null);
      if (!event) throw new Error('Cette chasse n’est plus présente dans la sauvegarde.');
      state.adv.event = { seq: event.seq, id: event.id, level: engine.CONFIG.EVENT.LEVEL, back: state.adv.chapter, loops: 0, runMs: 0 };
      teamKey = value;
      name = Game.DEX[event.id].name;
    } else if (kind === 'raid') {
      // Allies from friends live in game memory until joining; the running raid saves their exact stats.
      const event = save.adv.event;
      if (!event?.raid || event.reg !== value || !state.raids?.allies?.length) {
        throw new Error('Rejoins le raid pour lire les statistiques exactes de tes alliés.');
      }
      state.adv.event = { ...clone(event), runMs: 0 };
      teamKey = `raid:${value}`;
      name = Game.DEX[event.id].name;
    } else if (kind === 'story') {
      const chapter = Number(value), index = Number(step);
      const node = STORY.CHAPTERS[chapter]?.steps[index];
      if (!Number.isInteger(chapter) || !Number.isInteger(index) || !node || !['gym', 'trainer', 'static'].includes(node.kind)) {
        throw new Error('Rencontre inconnue.');
      }
      if (STORY.regionOf(chapter).key !== STORY.regionOf(save.adv.chapter).key) throw new Error('Choisis une rencontre de ta région.');
      state.adv.chapter = chapter;
      name = node.kind === 'static' ? Game.DEX[node.id].name : node.trainer || node.leader;
    } else if (kind === 'league') {
      if (value !== STORY.regionOf(save.adv.chapter).key) throw new Error('Choisis la Ligue de ta région.');
      const chapter = STORY.CHAPTERS.findIndex((chapter, ch) => chapter.league && STORY.regionOf(ch).key === value);
      if (chapter < 0) throw new Error('Ligue introuvable.');
      if (chapter > save.adv.unlocked) throw new Error('Cette Ligue est verrouillée.');
      state.adv.chapter = chapter;
      state.adv.kept = {};
      name = 'Ligue entière';
    } else if (kind !== 'tower') throw new Error('Rencontre inconnue.');
    return { state, kind, name, teamKey };
  }

  /** @param {import('./types/domain').Save} save @param {string} id @param {number} [now] @param {string[]} [teamIds] @returns {import('./types/domain').PreparedFight} */
  function prepare(save, id, now = Date.now(), teamIds) {
    const { state, kind, name, teamKey } = context(save, id, now);
    if (kind === 'tower') return prepareTower(state, id, now);
    const chosen = teamIds ?? (teamKey ? state.eventTeams[teamKey] : null);
    const selected = chosen?.length ? [...chosen] : kind === 'event' || kind === 'raid' ? [] :
      [...(kind === 'zone' ? state.team : save.road?.length ? save.road : save.team)];
    if (teamKey) state.eventTeams[teamKey] = selected;
    const prepared = GymSimulator.prepareTeam(state, now, selected, true);
    const s = prepared.state;
    return Game.sandbox(s, () => {
      if (kind === 'league') {
        Adventure.buildChapter(s.adv.chapter);
        return { ...prepared, encounterId: id, champion: { id, name, chapter: s.adv.chapter, badge: '', region: '', chapterName: '', enemies: [] } };
      }
      /** @type {import('./types/domain').BattleNode | undefined} */
      let node;
      if (kind === 'zone') {
        const zoneState = s.adv.zone;
        const zone = zoneState && LegendZones.get(zoneState.id);
        if (!zone || !zoneState) throw new Error('Zone introuvable.');
        node = { name: zone.zone, bg: zone.bg, areas: zone.areas, habitat: zone.habitat,
          ...'weather' in zone ? { weather: zone.weather } : {},
          ch: s.adv.chapter, type: 'static', id: zoneState.foe, level: zone.level, zone: zone.id, text: `${name} t'attend !` };
      } else if (kind === 'event') {
        const event = s.adv.event && Events.get(s.adv.event.seq);
        if (!event || !Events.isOpen(event.seq)) throw new Error('Cette chasse n’est pas ouverte.');
        node = Events.buildRun(event).find(node => node.legend);
      } else if (kind === 'raid') {
        if (!teamKey || !s.adv.event || !s.raids) throw new Error('Raid incomplet.');
        const mine = Game.eventTeam(teamKey).slice(0, engine.CONFIG.RAID.MINE);
        if (!mine.length || mine.length !== selected.length) throw new Error('Équipe de raid invalide.');
        s.road = [...mine, ...s.raids.allies.map(mon => mon.uid)];
        Game.teamMons().forEach(mon => { mon.hp = Game.maxHp(mon); engine.STATUS.clear(mon); });
        node = Raids.buildRun(s.adv.event).find(node => node.raid);
      } else {
        const [, ch, index] = id.split(':').map(Number);
        const step = clone(STORY.CHAPTERS[ch].steps[index]);
        node = { ...step, ch, type: step.kind };
        if (step.kind === 'gym') node.gym = step;
        if (step.kind === 'trainer') node.team = STORY.trainerTeam(ch, step);
        if (step.kind === 'static') node.level = STORY.staticLevel(ch, step);
      }
      if (!node) throw new Error('Adversaire introuvable.');
      Object.assign(s.adv, { nodes: [node], node: 0, battle: null, pending: null });
      if (node.type === 'gym' && !node.gym || !node.team && (!node.id || !node.level)) throw new Error('Équipe adverse invalide.');
      /** @type {Array<[number, number]>} */
      const team = node.gym ? STORY.gymTeam(s.adv.chapter, node.gym) : node.team || [];
      if (!team.length && node.id && node.level) team.push([node.id, node.level]);
      return { ...prepared, encounterId: id, champion: { id, name, chapter: s.adv.chapter, badge: '', region: '', chapterName: '',
        enemies: team.map(([id, level]) => ({ id, level, name: Game.DEX[id].name })) } };
    });
  }

  /** @param {import('./types/domain').Save} state @param {string} id @param {number} now @returns {import('./types/domain').PreparedFight} */
  function prepareTower(state, id, now) {
    return Game.sandbox(state, () => {
      // Tower caches its UID map: reset it whenever a different sandbox is restored.
      const run = state.tower?.run;
      Tower.finish();
      if (run) state.tower = { ...state.tower, run };
      const current = Tower.resume();
      state.adv.tower = { back: state.adv.chapter };
      state.adv.nodes = [Tower.floorNode(current.floor)];
      state.adv.node = 0;
      const team = Game.teamMons().map(mon => ({ uid: mon.uid, id: mon.id, name: Game.DEX[mon.id].name,
        level: mon.level, shiny: !!mon.shiny, rank: Game.rankOf(mon), hp: Game.curHp(mon) }));
      if (!team.length) throw new Error('Aucun Pokémon disponible pour cet étage.');
      const node = state.adv.nodes[0];
      return { state, team, now, autoSwitch: state.autoSwitch !== false, pendingTeam: false, encounterId: id,
        champion: { id, name: `Étage ${current.floor}`, chapter: state.adv.chapter, badge: '', region: '', chapterName: '',
          enemies: (node.team || []).map(([id, level]) => ({ id, level, name: Game.DEX[id].name })) } };
    });
  }

  /** @param {import('./types/domain').Save} save @param {string} id */
  function available(save, id) {
    const { state, kind } = context(save, id, Date.now());
    return Game.sandbox(state, () => state.mons.filter(mon => GymSimulator.validMon(mon) &&
      !Game.can(mon, kind === 'zone' ? 'zone' : kind === 'event' ? 'event' : 'adventure', state.adv.zone?.id))
      .map(mon => ({ uid: mon.uid, group: Game.beingOf(mon) })));
  }

  /** @param {import('./types/domain').Save} save @param {string} id */
  function team(save, id) {
    const [kind, value] = id.split(':');
    if (kind === 'event') return [...(save.eventTeams?.[value] || [])];
    if (kind === 'zone') return [...(save.eventTeams?.[id]?.length ? save.eventTeams[id] : save.team)];
    return [...(save.road?.length ? save.road : save.team)];
  }

  /** @param {import('./types/domain').PreparedFight} prepared @param {import('./types/domain').CombatEvent[] | null} [trace] @param {number} [seed] */
  function fight(prepared, trace, seed) {
    const random = Math.random;
    if (seed !== undefined) {
      let value = seed >>> 0;
      Math.random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
    }
    try {
      const state = clone(prepared.state);
      engine.setSnapshotTime(prepared.now);
      GymSimulator.restoreRegions(state);
      return Game.sandbox(state, () => {
        const circuit = prepared.encounterId?.startsWith('league:');
        const lastChapter = circuit ? STORY.leagueOf(state.adv.chapter)?.at(-1) : undefined;
        if (state.adv.tower) {
          const run = state.tower?.run;
          Tower.finish();
          if (!run) throw new Error('Run de Tour absente.');
          state.tower = { ...state.tower, run };
        }
        /** @type {import('./types/domain').Mon[] | undefined} */
        let enemies;
        /** @param {boolean} won @param {number} actions */
        const outcome = (won, actions) => ({ won, actions, survivors: won ? Game.teamMons().filter(mon => Game.curHp(mon) > 0).length : 0,
          progress: won ? 1 : enemies?.length ? enemies.reduce((sum, mon) => sum + 1 - Game.curHp(mon) / Game.maxHp(mon), 0) / enemies.length : 0 });
        for (let actions = 1; actions <= 20000; actions++) {
          // Advance nominal time for fleeing event legends, without moving the frozen wall clock.
          if (state.adv.event) Adventure.addTime(engine.CONFIG.ACTION_MS);
          const events = Adventure.step();
          enemies ||= state.adv.battle?.enemies;
          trace?.push(...clone(events));
          GymSimulator.applyEvolutions(events);
          if (circuit ? events.some(event => event.type === 'chapterEnd' && event.chapter === lastChapter) :
            events.some(event => event.type === 'victory' || event.type === 'fled' && event.spirit)) return outcome(true, actions);
          if (events.some(event => ['defeat', 'skip', 'fled', 'legendFled', 'eventClosed', 'raidOver', 'zoneOver', 'towerEnd'].includes(event.type))) return outcome(false, actions);
          if (!state.adv.battle && !circuit) throw new Error('Le combat s’est interrompu sans résultat.');
        }
        throw new Error('La simulation a dépassé sa limite d’actions.');
      });
    } finally { Math.random = random; }
  }

  globalThis.EncounterSimulator = { catalog, prepare, available, team, fight, interval: GymSimulator.interval };
})();
