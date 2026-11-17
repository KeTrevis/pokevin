const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../plugin/save-reader.js');
require('../engine/core.js');

async function main() {
  process.env.PORT = '0';
  assert.ok(process.env.GAME_DIR, 'GAME_DIR must point to the downloaded real game');
  const { startGame } = await import('../server/game.mjs');
  const server = await startGame();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-dev-save-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      viewport: { width: 1920, height: 1080 } });
    await context.route('**/*supabase.co/**', route => route.abort());
    const page = await context.newPage();
    const url = server.resolvedUrls.local[0];
    const read = async () => PokeCatchSave.parse(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')));
    await page.goto(url);
    await page.locator('.ti-go').click();
    await page.locator('.title-fx').waitFor({ state: 'detached' });
    let save = await read();
    assert.equal(save.mons.filter(mon => mon.id === 132).length, 1);
    const ditto = save.mons.find(mon => mon.id === 132);
    assert.ok(!save.team.includes(ditto.uid));
    await page.locator('#tabs [data-screen=team]').click();
    await page.locator(`#pc-grid [data-uid="${ditto.uid}"]`).waitFor();
    const guide = page.getByRole('button', { name: /^compris$/i });
    if (await guide.count()) await guide.click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#screen-team')).opacity === '1');
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))));
    const screenshot = path.resolve('artifacts/dev-default-metamorph.png');
    await page.screenshot({ path: screenshot });
    const png = fs.readFileSync(screenshot);
    assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    await page.goto(new URL('seed.html', url).href);
    save.mons = save.mons.filter(mon => mon.id !== 132);
    save.money = 12345;
    const existing = JSON.stringify(PokeCatchEngine.SaveWire.pack(save));
    assert.equal(JSON.parse(existing).fmt, 2);
    await page.evaluate(raw => {
      localStorage.setItem('gachamon-save-v1', raw);
      localStorage.removeItem('pokevin-dev-save-v1');
    }, existing);
    await page.goto(url);
    await page.locator('.ti-go').waitFor();
    save = await read();
    assert.equal(save.money, 12345);
    assert.equal(save.mons.filter(mon => mon.id === 132).length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('pokevin-dev-save-backup')), existing);
    await page.reload();
    await page.locator('.ti-go').waitFor();
    assert.equal((await read()).mons.filter(mon => mon.id === 132).length, 1);
    console.log('Real game: default Ditto in PC, existing progression and backup, reload without duplicates passed.');
    console.log('Screenshot:', screenshot);
  } finally {
    await context?.close(); await server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
