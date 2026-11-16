const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
require('../plugin/save-reader.js');
require('../engine/core.js');
require('../plugin/simulator.js');
require('../plugin/encounter-simulator.js');
require('../plugin/chapter-xp.js');

const uid = 'm1234567abcdef';
const caughtAt = parseInt(uid.slice(0, 8), 36) + 15;
function compactSave() {
  return {
    ...PokeCatchEngine.Game.freshState(), mons: undefined, fmt: 2,
    team: [uid], road: [uid],
    adv: { chapter: 0, unlocked: 0, layout: 6, nodes: [], node: 0, badges: [],
      gifts: { starter: true }, kept: {}, speed: 1 },
    dex: { 1: [2, 12345, 3, 1, 1], 4: { caught: 1, custom: true } },
    mz: { m: [[uid, 1, 10, 0, 0, 0, 15, { shiny: true, rank: 1, hp: 12, custom: 'kept' }]],
      r: ['kanto', 'johto'], w: ['Bourg Palette'], dx: 1, s: [7], o: [0, 'absent'] },
  };
}

test('decodes the current compact save, preserving all simulation and collection data', () => {
  const raw = JSON.stringify(compactSave());
  assert.throws(() => GymSimulator.validateSave(JSON.parse(raw)), /Sauvegarde absente ou incompatible/);
  const save = PokeCatchSave.parse(raw);
  assert.deepEqual(save.mons, [{ uid, id: 1, level: 10, xp: 0, shiny: true, rank: 1,
    hp: 12, custom: 'kept', reg: 'kanto', where: 'Bourg Palette', caughtAt }]);
  assert.deepEqual(save.dex, { 1: { caught: 2, firstAt: 12345, regs: { kanto: 1, johto: 1 }, shiny: 1, n: 1 },
    4: { caught: 1, custom: true } });
  assert.deepEqual(save.seen, { 1: true, 4: true, 7: true });
  assert.deepEqual(save.pcOrder, [uid, 'absent']);
  assert.equal(save.fmt, undefined);
  assert.equal(save.mz, undefined);
  assert.equal(JSON.stringify(compactSave()), raw);
  assert.doesNotThrow(() => GymSimulator.prepareTeam(save));
  const iterator = ChapterXP.estimate(save, 0);
  let result;
  do { result = iterator.next(); } while (!result.done);
  assert.ok(Number.isFinite(result.value.xpPerHour));
});

test('legacy saves pass through, while malformed data still fails validation', () => {
  const raw = JSON.stringify(PokeCatchEngine.Game.freshState());
  assert.deepEqual(PokeCatchSave.parse(raw), JSON.parse(raw));
  const save = compactSave();
  save.mz.m = [['short-uid', 1, 10, 0]];
  const mon = PokeCatchSave.parse(JSON.stringify(save)).mons[0];
  assert.equal(mon.shiny, false);
  assert.equal(mon.caughtAt, undefined);
  assert.throws(() => PokeCatchSave.parse('{'), SyntaxError);
  for (const invalid of [null, {}, { ...compactSave(), mz: {} }, { ...compactSave(), fmt: 99 }]) {
    const parsed = PokeCatchSave.parse(JSON.stringify(invalid));
    assert.throws(() => GymSimulator.prepareTeam(parsed));
  }
});

test('matches the real frontend SaveWire pack/unpack', { skip: !process.env.GAME_SAVE_BUNDLE }, () => {
  const source = fs.readFileSync(process.env.GAME_SAVE_BUNDLE, 'utf8');
  const start = source.indexOf('.SaveWire=function()');
  assert.ok(start >= 0, 'Find the official SaveWire implementation');
  const end = source.indexOf('(),function()', start);
  assert.ok(end > start);
  const native = vm.runInNewContext('(' + source.slice(start + '.SaveWire='.length, end + 2) + ')');
  const save = PokeCatchSave.parse(JSON.stringify(compactSave()));
  save.mons.push({ uid: 'plain', id: 4, level: 10, xp: 0, shiny: false });
  for (const mon of save.mons) mon.shiny = !!mon.shiny;
  const packed = native.pack(save);
  assert.equal(packed.fmt, 2);
  assert.deepEqual(PokeCatchSave.parse(JSON.stringify(packed)), JSON.parse(JSON.stringify(native.unpack(packed))));
});
