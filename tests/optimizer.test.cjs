const assert = require('node:assert/strict');
const { test } = require('node:test');
require('../engine/core.js');
require('../simulator.js');
require('../optimizer.js');
const { Game } = PokeCatchEngine;
const NOW = Date.UTC(2026, 10, 3, 18);
function fixture() {
  const save = Game.freshState();
  save.adv = { chapter: 0, unlocked: 0, badges: [], gifts: {}, kept: {}, layout: 6 };
  save.mons = [[129, 1], [3, 50], [6, 50], [3, 20]].map(([id, level], index) => ({
    ...Game.makeMon(id, level, { shiny: false }), uid: `owned-${index}`,
  }));
  save.team = [save.mons[0].uid];
  return save;
}
function run(save) {
  const job = TeamOptimizer.search(save, GymSimulator.champions(save)[0].id, NOW);
  let step, updates = 0;
  do { step = job.next(); if (!step.done) { updates++; assert.ok(step.value.trials > 0); } } while (!step.done);
  assert.ok(updates > 100);
  return step.value;
}
test('search improves a losing team using owned PC Pokémon, without changing the save or RNG', () => {
  const save = fixture(), before = JSON.stringify(save), random = Math.random;
  assert.ok(save.mons.every(mon => !('nature' in mon)), 'Current game saves have no nature field');
  assert.equal(GymSimulator.available(save).length, save.mons.length);
  const result = run(save);
  assert.equal(result.currentProbability, 0);
  assert.equal(result.probability, 1);
  assert.ok(result.team.some(mon => mon.uid === 'owned-1'));
  assert.ok(result.team.length <= 6);
  assert.equal(new Set(result.team.map(mon => mon.id)).size, result.team.length);
  assert.equal(JSON.stringify(save), before);
  assert.equal(Math.random, random);
  assert.equal(result.runs, 100);
  assert.ok(result.team.every(mon => !('nature' in mon)));
  assert.deepEqual(run(save), result, 'The same snapshot and seeds should reproduce the recommendation');
});
test('search can start from an empty team, excludes unavailable regions and reserved Pokémon', () => {
  const save = fixture();
  save.team = [];
  save.link = { side: 'from', from: 'kanto', to: 'johto' };
  save.pension = { mons: [{ mon: { ...Game.makeMon(150, 100, { shiny: false }), uid: 'reserved' } }] };
  const foreign = { ...Game.makeMon(152, 100, { shiny: false }), uid: 'foreign', reg: 'johto' };
  save.mons.push(foreign);
  const available = GymSimulator.available(save).map(mon => mon.uid);
  assert.ok(!available.includes('foreign'));
  assert.ok(!available.includes('reserved'));
  const result = run(save);
  assert.equal(result.currentProbability, null);
  assert.ok(result.team.every(mon => available.includes(mon.uid)));
});
test('cancellation closes the search between fights, restoring the engine and random generator', () => {
  const save = fixture(), before = JSON.stringify(save), random = Math.random, state = Game.S;
  const job = TeamOptimizer.search(save, GymSimulator.champions(save)[0].id, NOW);
  assert.equal(job.next().done, false);
  assert.equal(Math.random, random);
  assert.equal(job.return().done, true);
  assert.equal(job.next().done, true);
  assert.equal(Game.S, state);
  assert.equal(JSON.stringify(save), before);
});
test('a winning current team is kept when the final comparison finds no improvement', () => {
  const save = fixture();
  save.team = ['owned-1'];
  const result = run(save);
  assert.equal(result.currentProbability, 1);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.team.map(mon => mon.uid), save.team);
});
