const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Give the Vite fixture a free port rather than taking the developer's game port.
process.env.PORT = '0';
test('WXT uses automatic browser startup with a persistent profile shared by worktrees', async () => {
  const { default: config } = await import('../wxt.config.mjs');
  const { sharedDirectory } = await import('../server/paths.mjs');
  assert.equal(config.webExt.disabled, undefined);
  assert.equal(config.webExt.chromiumProfile, path.join(sharedDirectory, 'chrome-profile'));
  assert.equal(config.webExt.keepProfileChanges, true);
  assert.equal(config.manifest.key, require('../plugin/manifest.json').key);
});

test('Vite serves the local game without injecting an extension API emulation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-game-test-'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<html><head><title>Local game</title></head><body></body></html>');
  process.env.GAME_DIR = directory;
  let server;
  try {
    const { startGame } = await import('../server/game.mjs');
    server = await startGame();
    const html = await (await fetch(server.resolvedUrls.local[0])).text();
    assert.match(html, /Local game/);
    assert.match(html, /@vite\/client/);
    assert.doesNotMatch(html, /dev-loader|__pokevin|chrome\.runtime/);
    assert.ok(html.indexOf('/pokevin-dev-save.js') < html.indexOf('</head>'));
    const script = await (await fetch(new URL('/pokevin-dev-save.js', server.resolvedUrls.local[0]))).text();
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    vm.runInNewContext(script, { localStorage: storage, console });
    const save = JSON.parse(storage.getItem('gachamon-save-v1'));
    assert.ok(save.mons.some(mon => mon.id === 132));
    assert.equal(save.team.length, 3);
    assert.equal(save.trainer.name, 'Pokevin dev');
    vm.runInNewContext(script, { localStorage: storage, console });
    assert.equal(storage.getItem('gachamon-save-v1'), JSON.stringify(save));
  } finally {
    await server?.close();
    delete process.env.GAME_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('dev initialization adds Ditto once without replacing legacy or compact progression', async () => {
  const { initializeDevSave } = await import('../server/dev-save.mjs');
  const mon = { uid: 'ditto', id: 132, level: 15, xp: 0, caughtAt: 123 };
  for (const compact of [false, true]) {
    const original = { money: 12345, team: ['starter'], adv: {chapter: 12}, dex: {},
      ...(compact ? {fmt: 2, mz: {m: [['starter', 1, 15, 0]], r: [], w: [], s: [], o: [0], dx: 1}} :
        {mons: [{uid: 'starter', id: 1}], pcOrder: ['starter']}) };
    const raw = JSON.stringify(original);
    const values = new Map([['gachamon-save-v1', raw]]);
    const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
    initializeDevSave(storage, {mons: [mon]});
    const updated = JSON.parse(storage.getItem('gachamon-save-v1'));
    assert.equal(updated.money, original.money);
    assert.deepEqual(updated.adv, original.adv);
    assert.deepEqual(updated.team, original.team);
    assert.deepEqual((compact ? updated.mz.m : updated.mons)[1], mon);
    assert.deepEqual(globalThis.PokeCatchEngine.SaveWire.unpack(updated).mons[1], mon);
    assert.equal(storage.getItem('pokevin-dev-save-backup'), raw);
    const once = storage.getItem('gachamon-save-v1');
    initializeDevSave(storage, {mons: [mon]});
    assert.equal(storage.getItem('gachamon-save-v1'), once);
  }
});

test('dev initialization preserves invalid saves and Ditto already in the pension', async () => {
  const { initializeDevSave } = await import('../server/dev-save.mjs');
  for (const raw of ['broken JSON', JSON.stringify({mons: [], pension: {mons: [{mon: {id: 132}}]}})]) {
    const values = new Map([['gachamon-save-v1', raw]]);
    const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
    if (raw === 'broken JSON') assert.throws(() => initializeDevSave(storage, {}));
    else initializeDevSave(storage, {});
    assert.equal(storage.getItem('gachamon-save-v1'), raw);
  }
});
