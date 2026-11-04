const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');
const GAME = process.env.GAME_DIR;
if (!GAME) throw new Error('GAME_DIR must contain a downloaded copy of the current game.');

async function main() {
  const e = PokeCatchEngine, save = e.Game.freshState();
  save.trainer = { name: 'Test', sprite: 'red', feats: {} };
  save.reducedAnim = true;
  save.adv = { chapter: 4, unlocked: 9, badges: ['Roche', 'Cascade', 'Foudre', 'Prisme', 'Âme', 'Marais', 'Volcan', 'Terre'], gifts: { starter: true, 'silph-scope': true }, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, runs: 0, paused: true };
  save.mons = [76, 112, 143].map((id, i) => ({ ...e.Game.makeMon(id, 100, { shiny: true }), rank: 5, uid: `enc-browser-${i}` }));
  save.team = save.mons.map(mon => mon.uid);
  save.eventTeams['zone:145'] = [save.team[0]];
  save.dex = Object.fromEntries(e.POKEDEX.filter(mon => !mon.legendary && !mon.mythical && mon.id <= 151).map(mon => [mon.id, true]));
  save.lastTick = Date.now();
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const filename = path.resolve(GAME, '.' + (name === '/' ? '/index.html' : name));
    if (!filename.startsWith(path.resolve(GAME) + path.sep)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      if (name.startsWith('/assets/')) { res.writeHead(302, { Location: 'https://pokecatch-online.pages.dev' + name }); res.end(); return; }
      res.writeHead(404); res.end(); return;
    }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    if (name.endsWith(require('../engine/version.json').bundle)) {
      const source = fs.readFileSync(filename, 'utf8');
      const end = source.lastIndexOf('})();');
      assert.ok(end > 0);
      res.end(source.slice(0, end) + ';globalThis.NativeTest=t;' + source.slice(end));
    } else fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-encounters-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    viewport: { width: 1920, height: 1080 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  try {
    await context.addInitScript(state => {
      if (!localStorage.getItem('gachamon-save-v1')) localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      localStorage.setItem('pokecatch.lang', 'fr');
    }, save);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#app').waitFor();
    const title = page.locator('.title-fx .ti-go');
    await title.waitFor({ timeout: 5000 }).catch(() => {});
    if (await title.isVisible()) { await title.click(); await page.locator('.title-fx').waitFor({ state: 'hidden' }); }
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="Z145"]').click();
    const chance = page.locator('#pc-encounter-chance');
    const ready = () => page.waitForFunction(() => /\d+\s*%/.test(document.querySelector('.screen.active #pc-encounter-chance b')?.textContent || ''), null, { timeout: 30000 });
    await ready();
    await page.evaluate(() => { NativeTest.Game.S.adv.capture.on = false; NativeTest.Game.save(); });
    await page.evaluate(() => NativeTest.Game.holdSave(true));
    const before = await page.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    await page.getByRole('button', { name: '✨ Proposer une équipe', exact: true }).click();
    await page.locator('#pc-encounter-advisor[data-status="result"]').waitFor({ timeout: 120000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), before, 'Estimates never write to the save');
    const adventureTeam = await page.evaluate(() => [...NativeTest.Game.S.team]);
    await page.evaluate(() => { NativeTest.Game.S.adv.capture.on = false; NativeTest.Game.holdSave(false); });
    await page.getByRole('button', { name: 'Appliquer cette équipe', exact: true }).click();
    await page.getByRole('button', { name: 'Équipe appliquée', exact: true }).waitFor({ timeout: 30000 });
    const applied = await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')));
    assert.equal(applied.eventTeams['zone:145'].length, 3);
    assert.deepEqual(applied.team, adventureTeam, 'Applying a zone team leaves the adventure team intact');
    await ready();
    await chance.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Duel direct' }).waitFor();
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    const screenshot = async name => {
      const filename = path.join(ROOT, 'artifacts', name);
      await page.screenshot({ path: filename });
      const png = fs.readFileSync(filename);
      assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    };
    await screenshot('electhor-dark.png');
    await chance.press('Escape');
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await screenshot('electhor-light.png');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await chance.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.locator('#map-root [data-ch="4"]').click();
    await page.getByText('Autres rencontres', { exact: true }).click();
    const picker = page.getByLabel('Rencontre', { exact: true });
    await picker.waitFor();
    const options = await picker.locator('option').allTextContents();
    assert.ok(options.includes('Ronflex')); assert.ok(options.includes('Ossatueur'));
    await picker.selectOption({ label: 'Ronflex' }); await ready();
    await screenshot('encounter-ronflex.png');
    await page.locator('#map-root [data-ch="L"]').click();
    await picker.waitFor();
    assert.ok((await picker.locator('option').allTextContents()).includes('Olga'));
    await picker.selectOption({ label: 'Olga' }); await ready();
    await picker.selectOption({ label: 'Ligue entière' }); await ready();
    assert.equal(await page.locator('#pc-encounter-advisor').count(), 0);
    await page.evaluate(() => { NativeTest.Game.S.adv.badges.push('Maître Hoenn'); NativeTest.Game.save(); NativeTest.App.show('tower'); });
    await ready();
    assert.match(await page.locator('#pc-encounter-coach').innerText(), /Étage 1/);
    assert.equal(await page.locator('#pc-encounter-advisor').count(), 0);
    await page.evaluate(() => NativeTest.App.show('map'));
    await page.locator('#map-root [data-ch="Z145"]').click(); await ready();
    // A version difference warns without removing either the result or the action.
    await page.evaluate(() => [...document.scripts].find(script => /app\.[a-f0-9]+\.js/.test(script.src)).src = '/bundle/app.different.js');
    await chance.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Version du jeu différente' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '✨ Proposer une équipe', exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log('Native game passed: Électhor estimate, optimization, native zone-team application, fixed encounters, League, mobile, themes, version warning.');
    await page.locator('#map-root [data-ch="Z145"]').click(); await ready();
    console.log('Review URL:', page.url());
  } catch (error) {
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/encounters-debug.png') });
    console.log((await page.locator('body').innerText()).slice(-1600));
    throw error;
  } finally {
    if (process.env.KEEP_OPEN !== '1') { await context.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
    else console.log('Browser and local server kept open for review.');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
