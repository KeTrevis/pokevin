// Start the downloaded frontend locally, then set GAME_URL and GAME_SAVE_BUNDLE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const source = fs.readFileSync(process.env.GAME_SAVE_BUNDLE, 'utf8');
  const start = source.indexOf('.SaveWire=function()');
  const end = source.indexOf('(),function()', start);
  assert.ok(start >= 0 && end > start);
  const wire = vm.runInNewContext('(' + source.slice(start + '.SaveWire='.length, end + 2) + ')');
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'Local test', sprite: 'red', feats: {} };
  save.mons = [1, 4, 7, 3].map((id, i) => ({
    ...Game.makeMon(id, i === 3 ? 50 : 10, { shiny: false }), uid: `current-game-${i}`,
  }));
  save.team = save.mons.slice(0, 3).map(mon => mon.uid);
  save.adv = { chapter: 0, unlocked: 0, nodes: [], node: 0, layout: 6,
    badges: [], gifts: { starter: true }, kept: {}, speed: 1, paused: true, loops: [], runs: 0 };
  const packed = wire.pack(save);
  assert.equal(packed.fmt, 2);
  assert.equal(packed.mons, undefined);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-current-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      viewport: { width: 1920, height: 1080 },
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
    // Keep the local test independent of all live accounts and APIs.
    await context.route('**/*supabase.co/**', route => route.abort());
    const page = await context.newPage();
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8080/');
    await page.evaluate(state => {
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      localStorage.setItem('pokecatch.lang', 'fr');
    }, packed);
    await page.reload();
    await page.locator('.title-fx .ti-go').click();
    await page.locator('.title-fx').waitFor({ state: 'detached' });
    const loaded = await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')));
    const compact = wire.pack(wire.unpack(loaded));
    assert.equal(compact.fmt, 2);
    await page.evaluate(state => localStorage.setItem('gachamon-save-v1', JSON.stringify(state)), compact);
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    const xp = page.locator('#pc-chapter-xp');
    await page.waitForFunction(() => document.querySelector('#pc-chapter-xp b')?.textContent.startsWith('≈'));
    await page.waitForFunction(() => /%/.test(document.querySelector('#pc-arena-chance')?.textContent));
    await xp.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Version du jeu différente' }).waitFor();
    assert.doesNotMatch(await xp.innerText(), /Indisponible/);
    const before = wire.unpack(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1'))));
    await page.getByRole('button', { name: /Proposer une équipe/ }).click();
    await page.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    const searched = wire.unpack(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1'))));
    assert.deepEqual(searched.team, before.team, 'Searching must not equip the proposal while the real game ticks');
    await page.getByRole('button', { name: 'Appliquer cette équipe' }).click();
    await page.getByRole('button', { name: 'Équipe appliquée' }).waitFor();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')));
    assert.ok(after.team.includes('current-game-3'));
    // The game itself must still own encoding and persistence after native team edits.
    const decoded = wire.unpack(after);
    assert.ok(decoded.mons.some(mon => mon.uid === 'current-game-3'));
    assert.deepEqual(decoded.team, after.team);
    await page.waitForFunction(() => document.querySelector('#pc-chapter-xp b')?.textContent.startsWith('≈'));
    await xp.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Version du jeu différente' }).waitFor();
    const screenshot = path.join(ROOT, 'artifacts/current-game-save-fixed.png');
    await page.evaluate(() => Promise.all([...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width && rect.height && rect.top < innerHeight && rect.bottom > 0;
    }).map(image => {
      image.loading = 'eager';
      return image.decode().catch(() => {});
    })));
    await page.screenshot({ path: screenshot });
    const png = fs.readFileSync(screenshot);
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
    console.log('Current frontend: compact save, XP/h, gym chance, optimization, native team application passed.');
    console.log('Screenshot:', screenshot);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
