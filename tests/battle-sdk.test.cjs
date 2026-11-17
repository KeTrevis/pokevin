const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../engine/core.js');
require('../plugin/simulator.js');
require('../plugin/encounter-simulator.js');
require('../plugin/sdk/battles.js');
require('../plugin/scripts/victory-chance.js');

function fixture() {
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.adv = { chapter: 0, unlocked: 0, layout: 6, badges: [], gifts: {}, kept: {} };
  save.mons = [1, 4, 7].map((id, i) => ({ ...Game.makeMon(id, 15, { shiny: false }), uid: `sdk-${i}` }));
  save.team = save.mons.map(mon => mon.uid);
  return save;
}

test('SDK fights match the simulator, preserve snapshots, support alternative teams and close explicitly', async () => {
  const save = fixture(), before = structuredClone(save), now = Date.UTC(2026, 10, 16);
  const battle = await PokevinBattleSDK.battles.prepare(save, 0, { now, teamIds: [save.team[1]] });
  const prepared = GymSimulator.prepare(save, battle.champion.id, now, [save.team[1]]);
  assert.deepEqual(await battle.fight(42), GymSimulator.fight(prepared, null, 42));
  assert.deepEqual(await battle.fight(42), await battle.fight(42), 'Trials restart from the snapshot');
  assert.deepEqual(battle.team.map(mon => mon.uid), [save.team[1]]);
  assert.deepEqual(save, before);
  battle.close();
  await assert.rejects(battle.fight(), /fermée/);
  await assert.rejects(PokevinBattleSDK.battles.prepare(save, 0.5), /invalide/);
  await assert.rejects(PokevinBattleSDK.battles.interval(2, 1), /invalide/);
});

test('numeric targets prioritize a roaming encounter over the gym', async () => {
  const save = fixture(), now = Date.UTC(2026, 10, 16);
  Object.assign(save.adv, { chapter: 14, unlocked: 25, badges: ['Maître Johto'] });
  save.travel = { to: ['johto'] };
  save.roam = { at: { 243: { ch: 14, until: now + 60000 } }, caught: [] };
  const battle = await PokevinBattleSDK.battles.prepare(save, 14, { now });
  assert.equal(battle.champion.name, 'Raikou');
  assert.deepEqual(await battle.fight(42), EncounterSimulator.fight(EncounterSimulator.prepare(save, 'roaming:14:243', now), null, 42));
  battle.close();
});

test('the bundled script owns sampling and releases its battle on result, cancellation and failure', async () => {
  let fights = 0, closes = 0;
  const api = { prepare: async () => ({ champion: { name: 'Test' }, pendingTeam: false, now: 123,
    fight: async () => ({ won: ++fights % 4 === 0 }), close: () => { closes++; } }),
    interval: async (wins, runs) => [wins / runs, 1] };
  const script = PokevinVictoryChance(api, {}, 0);
  let step;
  do { step = await script.next(); } while (!step.done);
  assert.deepEqual(step.value, { wins: 25, runs: 100, probability: 0.25, interval: [0.25, 1], champion: 'Test', pendingTeam: false, now: 123 });
  assert.equal(closes, 1);
  const canceled = PokevinVictoryChance(api, {}, 0);
  await canceled.next(); await canceled.return();
  assert.equal(closes, 2);
  api.prepare = async () => ({ fight: async () => { throw new Error('fight failed'); }, close: () => { closes++; } });
  await assert.rejects(PokevinVictoryChance(api, {}, 0).next(), /fight failed/);
  assert.equal(closes, 3);
});

test('worker RPC keeps prepared state private, isolates ports and validates methods', async () => {
  global.chrome = { runtime: { getPlatformInfo: callback => callback({}), getURL: () => 'data:application/json,%7B%22bundle%22%3A%22test.js%22%7D' } };
  function port() {
    let receive, disconnect, sequence = 0;
    const pending = new Map();
    PokevinBattleSDK.connect({
      onMessage: { addListener: fn => { receive = fn; } },
      onDisconnect: { addListener: fn => { disconnect = fn; } },
      postMessage: reply => { pending.get(reply.requestId)(reply); pending.delete(reply.requestId); },
    });
    return { disconnect, call(method, args = {}) {
      const requestId = ++sequence;
      return new Promise(resolve => { pending.set(requestId, resolve); receive({ method, requestId, ...args }); });
    } };
  }
  const a = port(), b = port();
  const catalog = (await a.call('speciesCatalog')).value;
  assert.equal(catalog.bundle, 'test.js');
  assert.equal(catalog.species.find(mon => mon.id === 243).name, 'Raikou');
  catalog.species[0].types.length = 0;
  assert.ok((await a.call('speciesCatalog')).value.species[0].types.length);
  assert.equal(catalog.champions, undefined, 'Species lookup does not prepare battles or require a save');
  const prepared = await a.call('prepare', { save: fixture(), target: 0 });
  assert.equal(prepared.value.state, undefined);
  assert.ok(prepared.value.champion.name);
  assert.equal(typeof (await a.call('fight', { seed: 42 })).value.won, 'boolean');
  assert.match((await b.call('fight')).error, /Prépare/);
  assert.match((await a.call('unknown')).error, /inconnue/);
  a.disconnect(); b.disconnect();
  delete global.chrome;
});

test('SDK League targets simulate the full circuit in each region without changing the save', async () => {
  const now = Date.UTC(2026, 10, 17), { STORY } = PokeCatchEngine;
  const leagues = EncounterSimulator.catalog().filter(encounter => encounter.id.startsWith('league:'));
  assert.ok(leagues.length >= 5);
  for (const league of leagues) {
    const save = fixture();
    Object.assign(save.adv, { chapter: league.chapter, unlocked: league.chapter });
    const before = structuredClone(save);
    const battle = await PokevinBattleSDK.battles.prepare(save, league.id, { now });
    const prepared = EncounterSimulator.prepare(save, league.id, now);
    assert.equal(battle.champion.name, 'Ligue entière');
    assert.equal(battle.champion.enemies.length, STORY.leagueOf(league.chapter).flatMap(chapter =>
      STORY.CHAPTERS[chapter].steps.filter(step => step.kind === 'gym').flatMap(step => STORY.gymTeam(chapter, step))).length);
    assert.deepEqual(await battle.fight(42), EncounterSimulator.fight(prepared, null, 42));
    assert.deepEqual(save, before);
    battle.close();
  }
});

const vm = require('node:vm');
const fs = require('node:fs');
const badgeSource = fs.readFileSync(require.resolve('../plugin/scripts/victory-badge.js'), 'utf8');
test('the badge script samples whole leagues and ignores capture zones', async () => {
  for (const target of ['league:kanto', 'league:johto', 'league:hoenn', 'league:sinnoh', 'league:unova', 'zone:25']) {
    let callback, props, calculated, fights = 0;
    const api = { saves: { read: fixture }, chapters: { onViewed(fn) { callback = fn; } } };
    const scope = { ui: { chapterBadge(chapter, initial) {
      assert.equal(chapter, target); props = initial;
      return { update(patch) { props = { ...props, ...patch }; }, remove() { props = undefined; } };
    } }, battles: {
      catalog: async () => ({ champions: [], encounters: [{ id: target }], bundle: 'test.js' }),
      roaming() { assert.fail('Roaming lookup must only receive numeric chapters'); },
      async prepare(save, id) {
        calculated = id;
        return { champion: { name: 'Ligue entière' },
          fight: async () => ({ won: ++fights % 4 !== 0 }), close() {} };
      },
      interval: async () => [0.65, 0.85],
    } };
    vm.runInNewContext(badgeSource, {pokevin:api, PokevinVictoryChance});
    await callback({ chapterId: target }, scope);
    if (target.startsWith('zone:')) { assert.equal(props, undefined); continue; }
    assert.equal(calculated, target);
    assert.equal(fights, 100);
    assert.equal(props.text, '⚔️ Victoire 75 %');
    assert.equal(props.data.champion, 'Ligue entière');
    assert.equal(props.busy, false);
  }
});

test('badge state thresholds, colors and error messages use plain functions',()=>{
 const context={pokevin:{chapters:{onViewed(){}}}};
 vm.runInNewContext(badgeSource,context);
 for(const [probability,state,color] of [[0,'poor','var(--danger-text)'],[0.399,'poor','var(--danger-text)'],[0.4,'result','var(--caution)'],[0.649,'result','var(--caution)'],[0.65,'good','var(--green)'],[1,'good','var(--green)']]){
  assert.equal(context.getState(probability),state);
  assert.equal(context.getColor(state),color);
 }
 assert.equal(vm.runInNewContext('getErrorMessage(new Error("failed"))',context),'failed');
 assert.equal(context.getErrorMessage('failed'),'failed');
});
