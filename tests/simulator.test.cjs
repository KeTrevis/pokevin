const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ROOT = path.resolve(__dirname, '..');
const { bundle } = require('../engine/version.json');
const NOW = Date.UTC(2026, 10, 3, 18, 0, 0);
class FrozenDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }

function seeded(context, seed) {
  context.seed = seed;
  vm.runInContext('Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }', context);
}

function environment() {
  return vm.createContext({ console, structuredClone, Date: FrozenDate, performance,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  });
}

function simulator() {
  const context = environment();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'engine/core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'simulator.js'), 'utf8'), context);
  return context;
}

async function original() {
  const context = environment();
  Object.assign(context, {
    document: { documentElement: {}, addEventListener() {} },
    location: { hostname: 'localhost', origin: 'http://localhost:8080', pathname: '/' },
    localStorage: { getItem: () => null, setItem() {} },
    LANG_PICK: { lang: 'fr', pref: 'fr', LANGS: ['fr'] },
    addEventListener() {}, dispatchEvent() {}, AbortController,
    fetch: async () => ({ headers: { get: () => new Date(NOW).toUTCString() } }),
  });
  const source = fs.readFileSync(process.env.GAME_BUNDLE || path.join(ROOT, '../game/bundle', bundle), 'utf8');
  const end = source.indexOf(',t.Underground=function()');
  // Independent reference: original preamble + original core, with all module setup intact.
  vm.runInContext(source.slice(0, end) + ';globalThis.Reference=t;})();', context);
  await context.Reference.Clock.ready();
  const proposeStart = source.indexOf('function Rn(L){const le=L&&m.getMon(L.uid)');
  const proposeEnd = source.indexOf('function zn(L,le)', proposeStart);
  const evolveStart = source.indexOf('async function jn(L){const le=L.demo?');
  const evolveEnd = source.indexOf('function tt(L,', evolveStart);
  assert.ok(proposeStart >= 0 && proposeEnd > proposeStart && evolveStart >= 0 && evolveEnd > evolveStart);
  // Exercise the real UI's evolution handlers too. Only graphics/toasts are stubbed.
  vm.runInContext(`Reference.App={refresh(){}};Reference.UI={proposeEvolution:(function(){
    const m=Reference.Game,t=Reference,gn=new Set(),e=Reference._t,ie=String;
    const Pn=()=>{},mt=()=>{},at=()=>'';
    const Ta=()=>{throw new Error('A player must choose this evolution');};
    ${source.slice(proposeStart, proposeEnd)}
    ${source.slice(evolveStart, evolveEnd)}
    return Rn;
  })()};`, context);
  return context;
}

function fixture(context, chapter = 0, ids = [1, 4, 7, 25, 16, 12], level = 15) {
  const e = context.PokeCatchEngine;
  const save = e.Game.freshState();
  save.reducedAnim = true;
  save.adv = { chapter, unlocked: chapter, badges: [], gifts: {}, kept: {}, layout: 6 };
  save.travel = { to: e.STORY.REGIONS.filter(region => region.key && e.STORY.firstChapterOf(region.key) <= chapter).map(region => region.key) };
  save.mons = ids.map((id, index) => ({ ...e.Game.makeMon(id, level, { shiny: false }), uid: `fixture-${index}` }));
  save.team = save.mons.map(mon => mon.uid);
  return structuredClone(save);
}

function signature(events) {
  // The direct-duel adapter has no preceding route or respawn center.
  return JSON.parse(JSON.stringify(events.map(({ node, center, ...event }) => event)));
}

test('copied engine matches the original battle engine, including real gym construction', async () => {
  const ctx = simulator(), ref = await original(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  let checked = 0;
  for (const region of e.STORY.REGIONS.filter(region => region.key && region.key !== 'kanto2')) {
    const chapter = e.STORY.firstChapterOf(region.key);
    if (chapter < 0) continue;
    const save = fixture(ctx, chapter);
    for (const champion of sim.champions(save)) {
      // Cover native double battles, auto-switch off, status moves, shiny/rank and damaged inputs.
      save.autoSwitch = checked % 2 === 0;
      save.mons[0].shiny = true; save.mons[0].rank = 2;
      save.mons[0].hp = 1; save.mons[0].status = 'poison';
      save.mons.forEach(mon => { mon.level = Math.max(...champion.enemies.map(enemy => enemy.level)); });
      const prepared = sim.prepare(save, champion.id, NOW);
      const referenceState = structuredClone(prepared.state), r = ref.Reference;
      for (const region of r.STORY.REGIONS) if (region.key) region.open = save.travel.to.includes(region.key);
      r.Game.sandbox(referenceState, () => {
        r.Adventure.buildChapter(champion.chapter);
        referenceState.adv.node = referenceState.adv.nodes.findIndex(node => node.type === 'gym' && node.gym.leader === champion.name);
        assert.ok(referenceState.adv.node >= 0);
        r.Game.healTeam();
      });
      for (let seed = 1; seed <= 4; seed++) {
        const state = structuredClone(referenceState), expected = [];
        seeded(ctx, seed * 7919); seeded(ref, seed * 7919);
        const actual = [];
        const outcome = sim.fight(prepared, actual);
        let terminal;
        r.Game.sandbox(state, () => {
          for (let step = 0; step < 20000; step++) {
            const events = r.Adventure.step(); expected.push(...structuredClone(events));
            if (events.some(event => event.type === 'victory' && event.kind === 'gym')) { terminal = true; break; }
            if (events.some(event => ['defeat', 'skip'].includes(event.type))) { terminal = false; break; }
          }
        });
        assert.equal(outcome.won, terminal, champion.name);
        assert.deepEqual(signature(actual), signature(expected), `${region.key} / ${champion.name} / seed ${seed}`);
      }
      checked++;
    }
  }
  assert.ok(checked >= 24, `Only checked ${checked} champions`);
  console.log(`Parity verified for ${checked} champions × 4 seeds.`);
});

test('trials heal the team, preserve the snapshot and never retain battle XP', () => {
  const ctx = simulator(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  const save = fixture(ctx), before = JSON.stringify(save);
  save.mons[0].hp = 0; save.mons[0].status = 'burn';
  const injured = JSON.stringify(save);
  const prepared = sim.prepare(save, sim.champions(save)[0].id, NOW);
  assert.equal(JSON.stringify(save), injured);
  assert.equal(prepared.state.mons[0].status, undefined);
  assert.ok(prepared.state.mons[0].hp > 1);
  const base = JSON.stringify(prepared.state);
  seeded(ctx, 10); const traceA = []; const first = sim.fight(prepared, traceA);
  seeded(ctx, 10); const traceB = []; const second = sim.fight(prepared, traceB);
  assert.deepEqual(first, second);
  assert.deepEqual(signature(traceA), signature(traceB));
  assert.equal(JSON.stringify(prepared.state), base);
  assert.equal(JSON.stringify(save), injured);
  assert.equal(e.Game.S, undefined);
  assert.notEqual(before, injured);
});

test('uses the actual road team, and counts a replay defeat as a loss', () => {
  const ctx = simulator(), sim = ctx.GymSimulator;
  const save = fixture(ctx, 0, [129, 150], 1);
  save.road = [save.team[0]]; save.team = [save.team[1]];
  save.adv.badges = ['Roche']; save.adv.unlocked = 9;
  const prepared = sim.prepare(save, sim.champions(save)[0].id, NOW);
  assert.equal(prepared.team.length, 1);
  assert.equal(prepared.team[0].id, 129);
  assert.equal(prepared.pendingTeam, true);
  seeded(ctx, 42);
  const trace = [];
  assert.equal(sim.fight(prepared, trace).won, false);
  assert.ok(trace.some(event => event.type === 'skip'));
});

test('current saves without natures work and legacy nature fields do not affect battles', () => {
  const ctx = simulator(), sim = ctx.GymSimulator;
  const save = fixture(ctx), champion = sim.champions(save)[0].id;
  assert.ok(save.mons.every(mon => !('nature' in mon)));
  assert.equal(sim.available(save).length, save.mons.length);
  const current = sim.prepare(save, champion, NOW);
  const trace = [];
  sim.fight(current, trace, 42);
  save.mons.forEach(mon => { mon.nature = 3; });
  const before = JSON.stringify(save), legacyTrace = [];
  sim.fight(sim.prepare(save, champion, NOW), legacyTrace, 42);
  assert.deepEqual(signature(legacyTrace), signature(trace));
  assert.equal(JSON.stringify(save), before);
});

test('rejects invalid or unsupported teams instead of silently estimating', () => {
  const ctx = simulator(), sim = ctx.GymSimulator;
  const save = fixture(ctx), champion = sim.champions(save)[0].id;
  assert.throws(() => sim.prepare({ ...save, team: [] }, champion), /équipe/);
  assert.throws(() => sim.prepare(save, '999:0'), /champion/);
  assert.throws(() => sim.prepare({ ...save, adv: { ...save.adv, event: { id: 144 } } }, champion), /aventure normale/);
  save.mons[0].level = 101;
  assert.throws(() => sim.prepare(save, champion), /compatibles/);
});

test('Wilson interval stays meaningful for zero and perfect observed wins', () => {
  const { interval } = simulator().GymSimulator;
  const [lo, hi] = interval(500, 1000);
  assert.ok(lo < .5 && hi > .5 && hi - lo < .063);
  assert.ok(interval(0, 1000)[1] > 0);
  assert.ok(interval(1000, 1000)[0] < 1);
  assert.throws(() => interval(0, 0));
});

test('interleaved game tabs restore their own regional progression', () => {
  const ctx = simulator(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  const johtoSave = fixture(ctx, e.STORY.firstChapterOf('johto'));
  const champion = sim.champions(johtoSave)[0].id;
  const johto = sim.prepare(johtoSave, champion, NOW);
  seeded(ctx, 123); const before = []; sim.fight(johto, before);
  const kantoSave = fixture(ctx);
  const kanto = sim.prepare(kantoSave, sim.champions(kantoSave)[0].id, NOW);
  sim.fight(kanto);
  seeded(ctx, 123); const after = []; sim.fight(johto, after);
  assert.deepEqual(signature(after), signature(before));
});

test('a level-up evolution changes the next attacks, just like the original UI', async () => {
  const ctx = simulator(), ref = await original(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  const save = fixture(ctx, 1, [2], 31);
  save.adv.unlocked = 5;
  e.Game.sandbox(save, () => { save.mons[0].xp = e.Game.xpForNext(31, save.mons[0]) - 1; });
  const prepared = sim.prepare(save, sim.champions(save).find(champion => champion.name === 'Ondine').id, NOW);
  const baseline = JSON.stringify(prepared.state);
  const originalSave = JSON.stringify(save);
  const seen = [];
  const statsOf = e.Game.statsOf;
  e.Game.statsOf = mon => { if (mon.uid === save.team[0]) seen.push({ id: mon.id, level: mon.level }); return statsOf(mon); };
  seeded(ctx, 7919); seeded(ref, 7919);
  const actual = [], expected = [];
  const result = sim.fight(prepared, actual);
  const state = structuredClone(prepared.state), r = ref.Reference;
  r.Game.sandbox(state, () => {
    for (let step = 0; step < 20000; step++) {
      const events = r.Adventure.step();
      expected.push(...structuredClone(events));
      for (const event of events) if (event.type === 'xp' && event.evolve) r.UI.proposeEvolution(event.evolve);
      if (events.some(event => event.type === 'victory' || event.type === 'defeat' || event.type === 'skip')) break;
    }
  });
  assert.ok(expected.some(event => event.type === 'xp' && event.evolve?.to === 3));
  assert.ok(seen.some(mon => mon.id === 3 && mon.level === 32), 'Use Venusaur stats in the remaining turns');
  assert.deepEqual(signature(actual), signature(expected));
  assert.equal(result.won, true);
  assert.equal(JSON.stringify(prepared.state), baseline, 'Discard the simulated evolution after every trial');
  assert.equal(JSON.stringify(save), originalSave, 'Never evolve the real saved Pokémon');
});

test('ranked Pokémon keep their original form when leveling up', () => {
  const ctx = simulator(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  const save = fixture(ctx, 1, [2], 31);
  save.adv.unlocked = 5;
  save.mons[0].rank = 1;
  e.Game.sandbox(save, () => { save.mons[0].xp = e.Game.xpForNext(31, save.mons[0]) - 1; });
  const prepared = sim.prepare(save, sim.champions(save)[1].id, NOW);
  seeded(ctx, 7919);
  const trace = [];
  sim.fight(prepared, trace);
  assert.ok(trace.some(event => event.type === 'xp' && event.levels > 0));
  assert.ok(trace.filter(event => event.type === 'xp').every(event => event.evolve === null));
});

test('an evolved form already owned in the PC still blocks a duplicate evolution', () => {
  const ctx = simulator(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  const save = fixture(ctx, 1, [2], 31);
  save.adv.unlocked = 5;
  save.mons.push({ ...e.Game.makeMon(3, 32, { shiny: false }), uid: 'pc-venusaur' });
  e.Game.sandbox(save, () => {
    save.mons[0].xp = e.Game.xpForNext(31, save.mons[0]) - 1;
    assert.equal(e.Game.evoBlocked(save.mons[0], 3), true);
  });
  const prepared = sim.prepare(save, sim.champions(save)[1].id, NOW);
  seeded(ctx, 7919);
  const trace = [];
  sim.fight(prepared, trace);
  assert.ok(trace.some(event => event.type === 'xp' && event.levels > 0));
  assert.ok(trace.filter(event => event.type === 'xp').every(event => event.evolve === null));
});

test('a branching evolution pauses the estimate instead of choosing for the player', () => {
  const ctx = simulator(), sim = ctx.GymSimulator, e = ctx.PokeCatchEngine;
  const save = fixture(ctx, 1, [3, 236], 50);
  save.mons[1].level = 19;
  save.adv.unlocked = 5;
  save.travel.to = ['kanto', 'johto'];
  e.Game.sandbox(save, () => { save.mons[1].xp = e.Game.xpForNext(19, save.mons[1]) - 1; });
  const prepared = sim.prepare(save, sim.champions(save)[1].id, NOW);
  const baseline = JSON.stringify(save);
  seeded(ctx, 7919);
  assert.throws(() => sim.fight(prepared), /choix du joueur/);
  assert.equal(JSON.stringify(save), baseline);
  assert.equal(e.Game.S, undefined, 'Restore the sandbox even when a player choice is required');
});
