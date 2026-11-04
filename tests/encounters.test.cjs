const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ROOT = path.resolve(__dirname, '..');
const NOW = Date.UTC(2026, 10, 4, 12);
class FrozenDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
function environment() {
  return vm.createContext({ console, structuredClone, Date: FrozenDate, performance,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    document: { documentElement: {}, addEventListener() {} },
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/' },
    localStorage: { getItem: () => null, setItem() { throw new Error('Unexpected storage write'); } },
    LANG_PICK: { lang: 'fr', pref: 'fr', LANGS: ['fr'] },
    addEventListener() {}, dispatchEvent() {}, AbortController,
    fetch: async () => ({ headers: { get: () => new Date(NOW).toUTCString() } }),
  });
}
function simulator() {
  const ctx = environment();
  for (const file of ['engine/core.js', 'simulator.js', 'encounter-simulator.js', 'optimizer.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx);
  return ctx;
}
function fixture(ctx, chapter = 0, level = 100) {
  const e = ctx.PokeCatchEngine, s = e.Game.freshState();
  s.adv = { chapter, unlocked: 65, layout: 6, badges: ['Maître', 'Maître Johto', 'Maître Hoenn', 'Maître Sinnoh'], gifts: {}, kept: {}, nodes: [], speed: 1 };
  s.mons = [76, 112, 143, 248, 3, 9].map((id, i) => ({ ...e.Game.makeMon(id, level, { shiny: false }), uid: `enc-${i}` }));
  s.team = s.mons.map(mon => mon.uid);
  s.travel = { to: ['johto', 'hoenn', 'sinnoh', 'kanto2'] };
  s.dex = Object.fromEntries(e.POKEDEX.filter(mon => !mon.legendary && !mon.mythical).map(mon => [mon.id, true]));
  ctx.GymSimulator.restoreRegions(s);
  e.Game.sandbox(s, () => e.Roaming.update(NOW));
  return structuredClone(s);
}
const clean = events => JSON.parse(JSON.stringify(events.map(({ node, center, ...event }) => event)));
function seeded(ctx, seed) {
  ctx.seed = seed;
  vm.runInContext('Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }', ctx);
}

test('zone duels use the dedicated team, cap stats, preserve the save and restore RNG', () => {
  const ctx = simulator(), e = ctx.PokeCatchEngine, sim = ctx.EncounterSimulator, save = fixture(ctx);
  save.mons[0].hp = 1; save.mons[0].status = 'burn';
  save.eventTeams['zone:145'] = [save.team[0]];
  e.LegendZones.get(145).level = 50;
  const before = JSON.stringify(save), random = vm.runInContext('Math.random', ctx);
  const p = sim.prepare(save, 'zone:145', NOW), initial = JSON.stringify(p.state);
  assert.equal(p.team.length, 1); assert.equal(p.team[0].id, 76);
  assert.equal(p.team[0].level, 50);
  assert.equal(p.state.mons[0].status, undefined);
  const a = [], b = [];
  assert.deepEqual(sim.fight(p, a, 42), sim.fight(p, b, 42));
  assert.deepEqual(clean(a), clean(b));
  assert.ok(a.some(event => event.type === 'rage'));
  assert.equal(JSON.stringify(save), before); assert.equal(JSON.stringify(p.state), initial);
  assert.equal(vm.runInContext('Math.random', ctx), random);
  assert.throws(() => sim.fight({ ...p, state: { ...p.state, uncloneable: () => {} } }, null, 42));
  assert.equal(vm.runInContext('Math.random', ctx), random);
  assert.equal(e.Game.S, undefined);
  assert.throws(() => sim.prepare(save, 'zone:493', NOW), /serveur/);
});

test('a defeated static or event legend is a win even when capture fails', () => {
  const ctx = simulator(), sim = ctx.EncounterSimulator, save = fixture(ctx, 4);
  save.mons.forEach(mon => { mon.rank = 5; mon.shiny = true; });
  const encounter = sim.catalog().find(item => item.name === 'Ronflex');
  const trace = [];
  const p = sim.prepare(save, encounter.id, NOW);
  assert.equal(sim.fight(p, trace, 5).won, true);
  const spirit = sim.catalog().find(item => item.name === 'Ossatueur');
  assert.equal(sim.fight(sim.prepare(save, spirit.id, NOW), [], 1).won, true);
  ctx.PokeCatchEngine.CONFIG.EVENT.ENABLED = true;
  save.events = { seq: 1, cur: { id: 145, seq: 1, openAt: NOW - 1, closeAt: NOW + 3600000, end: null }, shards: 0, traces: {}, wins: [] };
  save.eventTeams[145] = [...save.team];
  const eventTrace = [];
  assert.equal(sim.fight(sim.prepare(save, 'event:145', NOW), eventTrace, 1).won, true);
  assert.ok(eventTrace.some(event => event.type === 'capture' && !event.success));
});

test('named trainers and League leaders are listed and simulated, invalid targets are rejected', () => {
  const ctx = simulator(), sim = ctx.EncounterSimulator, save = fixture(ctx, 17);
  const sayo = sim.catalog().find(item => item.name === 'Kimono Sayo');
  assert.equal(sim.fight(sim.prepare(save, sayo.id, NOW), [], 7).won, true);
  assert.ok(sim.catalog().some(item => item.kind === 'league:kanto'));
  assert.throws(() => sim.prepare(save, 'story:999:0', NOW), /inconnue/);
  assert.throws(() => sim.prepare(save, 'raid:kanto', NOW), /Rejoins/);
  assert.throws(() => sim.prepare(save, 'event:145', NOW), /chasse/);
  assert.throws(() => sim.prepare({ ...save, adv: { ...save.adv, layout: 5 } }, 'tower', NOW), /actualisée/);
  assert.throws(() => sim.prepare(save, 'tower', NaN), /Date/);
});

test('Tower trials keep the run health and reset the native UID cache across snapshots', () => {
  const ctx = simulator(), e = ctx.PokeCatchEngine, sim = ctx.EncounterSimulator, save = fixture(ctx, 30);
  let p = sim.prepare(save, 'tower', NOW);
  const uid = p.state.tower.run.mons[0].uid;
  p.state.tower.run.mons[0].hp = 1;
  const injured = structuredClone(p.state);
  const q = sim.prepare(injured, 'tower', NOW);
  assert.equal(q.state.tower.run.mons.find(mon => mon.uid === uid).hp, 1);
  const before = JSON.stringify(q.state);
  sim.fight(q, [], 3); sim.fight(p, [], 4); sim.fight(q, [], 3);
  assert.equal(JSON.stringify(q.state), before);
  assert.equal(e.Game.S, undefined);
});

test('the full League ends only after the final chapter and counts the first defeat as a loss', () => {
  const ctx = simulator(), sim = ctx.EncounterSimulator, save = fixture(ctx, 4);
  const trace = [];
  save.mons.forEach(mon => { mon.rank = 5; });
  const prepared = sim.prepare(save, 'league:kanto', NOW);
  const baseline = JSON.stringify(save);
  assert.equal(sim.fight(prepared, trace, 3).won, true);
  const circuit = ctx.PokeCatchEngine.STORY.leagueOf(prepared.state.adv.chapter);
  assert.ok(trace.some(event => event.type === 'chapterEnd' && event.chapter === circuit.at(-1)));
  assert.equal(JSON.stringify(save), baseline);
  const weak = fixture(ctx, 4, 1);
  weak.team = [weak.team[0]];
  const lostTrace = [];
  assert.equal(sim.fight(sim.prepare(weak, 'league:kanto', NOW), lostTrace, 2).won, false);
  assert.ok(lostTrace.some(event => event.type === 'defeat' || event.type === 'skip'));
});

test('raid duels include the saved allies, retain their statistics and leave the raid unchanged', () => {
  const ctx = simulator(), e = ctx.PokeCatchEngine, sim = ctx.EncounterSimulator, save = fixture(ctx, 4);
  save.adv.event = { raid: true, reg: 'kanto', date: e.Raids.dateKey(NOW), id: 25, seq: 'R:kanto', level: 100, back: 4, loops: 0 };
  save.eventTeams['raid:kanto'] = save.team.slice(0, 2);
  save.raids = { allies: [{ ...e.Game.makeMon(3, 100, { shiny: false }), uid: 'saved-ally', bot: true, statMult: 1.2 }] };
  const before = JSON.stringify(save), p = sim.prepare(save, 'raid:kanto', NOW), trace = [];
  assert.ok(p.state.road.includes('saved-ally'));
  sim.fight(p, trace, 2);
  assert.ok(trace.some(event => event.type === 'attack' && event.uid === 'saved-ally'));
  assert.equal(JSON.stringify(save), before);
});

test('zone optimizer tests owned compositions without changing the configured team', () => {
  const ctx = simulator(), save = fixture(ctx);
  save.eventTeams['zone:145'] = [save.team[0]];
  const before = JSON.stringify(save), search = ctx.TeamOptimizer.search(save, 'zone:145', NOW);
  let step, count = 0;
  do { step = search.next(); count++; } while (!step.done && count < 100000);
  assert.ok(step.done); assert.ok(step.value.team.length);
  assert.equal(JSON.stringify(save), before);
});

const sourcePath = process.env.GAME_BUNDLE;
test('special duels match native construction and combat, including seven legendary zones and Deoxys forms', { skip: !sourcePath }, async () => {
  const ctx = simulator(), ref = environment();
  const source = fs.readFileSync(sourcePath, 'utf8');
  // Independent reference retains the original preamble and every module through Roaming.
  vm.runInContext(source.slice(0, source.indexOf(',t.Sfx=')) + ';globalThis.Reference=t;})();', ref);
  await ref.Reference.Clock.ready();
  const r = ref.Reference, sim = ctx.EncounterSimulator;
  for (const id of [145, 144, 146, 150, 249, 383, 386]) {
    const save = fixture(ctx);
    save.dex = Object.fromEntries(ctx.PokeCatchEngine.POKEDEX.filter(mon => mon.id !== id && !ctx.PokeCatchEngine.LegendZones.get(id)?.forms?.includes(mon.id)).map(mon => [mon.id, true]));
    save.mons.push(...ctx.PokeCatchEngine.POKEDEX.filter(mon => (mon.legendary || mon.mythical) && mon.id !== id && !ctx.PokeCatchEngine.LegendZones.get(id)?.forms?.includes(mon.id)).map(mon => ({ ...ctx.PokeCatchEngine.Game.makeMon(mon.id, 100, { shiny: false }), uid: `owned-${mon.id}` })));
    save.items.auroraticket = 1;
    save.aurora = { week: ctx.PokeCatchEngine.Tower.weekKey(NOW), id: 38601 };
    save.eventTeams[`zone:${id}`] = [...save.team];
    const prepared = sim.prepare(save, `zone:${id}`, NOW);
    for (const seed of [1, 7]) {
      const state = structuredClone(save);
      const originalEvents = [], actual = [];
      seeded(ref, seed); seeded(ctx, seed);
      r.Game.sandbox(state, () => {
        assert.equal(r.Adventure.startZone(id), true, `zone ${id}: ${r.LegendZones.state(r.LegendZones.get(id))}`);
        state.adv.node = state.adv.nodes.findIndex(node => node.type === 'static');
        // Starting a direct duel skips only the journey, not the native boss setup.
      });
      seeded(ref, seed); seeded(ctx, seed);
      const outcome = sim.fight(prepared, actual);
      let won;
      r.Game.sandbox(state, () => {
        for (let i = 0; i < 20000; i++) {
          const events = r.Adventure.step(); originalEvents.push(...structuredClone(events));
          if (events.some(event => event.type === 'victory')) { won = true; break; }
          if (events.some(event => ['defeat', 'fled', 'skip'].includes(event.type))) { won = false; break; }
        }
      });
      assert.equal(outcome.won, won, `zone ${id}`);
      assert.deepEqual(clean(actual), clean(originalEvents), `zone ${id} / ${seed}`);
    }
  }
  ctx.PokeCatchEngine.CONFIG.EVENT.ENABLED = r.CONFIG.EVENT.ENABLED = true;
  for (const kind of ['event', 'static', 'trainer', 'raid', 'tower']) {
    const save = fixture(ctx, kind === 'trainer' ? 17 : 4);
    save.adv.gifts['silph-scope'] = true;
    let id;
    if (kind === 'event') {
      save.events = { cur: { id: 145, seq: 1, openAt: NOW - 1, closeAt: NOW + 3600000, end: null }, shards: 0, traces: {}, wins: [] };
      save.eventTeams[145] = [...save.team]; id = 'event:145';
    } else if (kind === 'raid') {
      save.adv.event = { raid: true, reg: 'kanto', date: r.Raids.dateKey(NOW), id: 25, seq: 'R:kanto', level: 100, back: 4, loops: 0 };
      save.eventTeams['raid:kanto'] = save.team.slice(0, 2);
      save.raids = { allies: [{ ...ctx.PokeCatchEngine.Game.makeMon(3, 100, { shiny: false }), uid: 'parity-ally', bot: true, statMult: 1.2 }] };
      id = 'raid:kanto';
    } else if (kind === 'tower') id = 'tower';
    else id = sim.catalog().find(item => item.name === (kind === 'static' ? 'Ronflex' : 'Kimono Sayo')).id;
    seeded(ctx, 13); seeded(ref, 13);
    const prepared = sim.prepare(save, id, NOW), state = structuredClone(save);
    r.Game.sandbox(state, () => {
      if (kind === 'event') { assert.equal(r.Adventure.startEvent(1), true); state.adv.node = state.adv.nodes.findIndex(node => node.legend); }
      else if (kind === 'tower') assert.equal(r.Adventure.startTower(true), true);
      else if (kind === 'raid') {
        state.adv.nodes = r.Raids.buildRun(state.adv.event); state.adv.node = state.adv.nodes.findIndex(node => node.raid);
        r.Game.healTeam();
      } else {
        r.Adventure.buildChapter(Number(id.split(':')[1]));
        state.adv.node = state.adv.nodes.findIndex(node => kind === 'static' ? node.type === 'static' && node.id === 143 : node.type === 'trainer' && node.trainer === 'Kimono Sayo');
        assert.ok(state.adv.node >= 0); r.Game.healTeam();
      }
    });
    seeded(ctx, 7); seeded(ref, 7);
    const actual = [], expected = [];
    const result = sim.fight(prepared, actual);
    let won;
    r.Game.sandbox(state, () => {
      for (let i = 0; i < 20000; i++) {
        if (state.adv.event) r.Adventure.addTime(r.CONFIG.ACTION_MS);
        const events = r.Adventure.step(); expected.push(...structuredClone(events));
        if (events.some(event => event.type === 'victory')) { won = true; break; }
        if (events.some(event => ['defeat', 'skip', 'fled', 'legendFled'].includes(event.type))) { won = false; break; }
      }
    });
    assert.equal(result.won, won, kind);
    // Tower gives its deterministic roster a cosmetic random trainer name before the duel.
    const signature = events => clean(events).map(event => kind === 'tower' ? (({ trainer, ...rest }) => rest)(event) : event);
    assert.deepEqual(signature(actual), signature(expected), kind);
  }
});
