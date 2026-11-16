const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  } finally {
    await server?.close();
    delete process.env.GAME_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
