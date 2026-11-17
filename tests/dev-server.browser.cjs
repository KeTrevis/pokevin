// WXT launches the real extension; this test never installs it through Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = path.join(ROOT, 'web-ext.config.ts');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-wxt-'));
let runner, browser, original;
const cssFile = path.join(ROOT, 'plugin/ui/pension.css');

async function main() {
  assert.ok(!fs.existsSync(config), 'Move your local web-ext.config.ts before running this isolated test');
  const net = require('node:net');
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const cdpPort = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  fs.writeFileSync(config, `export default ${JSON.stringify({
    binaries: { chrome: chromium.executablePath() },
    chromiumProfile: path.join(temporary, 'profile'),
    chromiumPort: cdpPort,
    chromiumArgs: ['--headless=new', `--remote-debugging-port=${cdpPort}`],
  })};\n`);
  let output = '';
  runner = spawn(process.execPath, [path.join(ROOT, 'node_modules/wxt/bin/wxt.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: '8096', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  runner.stdout.on('data', data => { output += data; });
  runner.stderr.on('data', data => { output += data; });
  const deadline = Date.now() + 90000;
  while (!browser && Date.now() < deadline) {
    if (runner.exitCode !== null) throw new Error(output);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`); }
    catch { await pause(300); }
  }
  assert.ok(browser, 'WXT did not start Chrome:\n' + output);
  for (let attempt = 0; !output.includes('Opened browser') && attempt < 100; attempt++) await pause(100);
  assert.match(output, /Opened browser/);
  const context = browser.contexts()[0];
  // WXT opens the game itself. Close it so two tabs cannot autosave different test parties.
  for (const initial of context.pages()) await initial.close();
  await context.route('**/*supabase.co/**', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => console.log('Page error:', error.message));
  page.on('console', message => { if(message.type()==='error') console.log('Console:', message.text().slice(0,300)); });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'WXT test', sprite: 'red', feats: {} };
  save.mons = [1, 4, 7].map((id, index) => ({ ...Game.makeMon(id, 15, { shiny: false }), uid: `wxt-${index}` }));
  save.team = save.mons.map(mon => mon.uid);
  save.adv = { chapter: 0, unlocked: 0, badges: [], gifts: { starter: 1 }, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, paused: true, runs: 0 };
  await context.addInitScript(save => {
    if (localStorage.getItem('pokevin-wxt-seeded')) return;
    localStorage.setItem('pokevin-wxt-seeded', 'true');
    localStorage.setItem('gachamon-save-v1', JSON.stringify(save));
    localStorage.setItem('pokecatch.lang', 'fr');
    localStorage.setItem('pokecatch-guide-seen', JSON.stringify(['adv', 'catch', 'team', 'league']));
    localStorage.setItem('pokevin-script', '// WXT retained script');
  }, save);
  await page.goto('http://127.0.0.1:8096/');
  await page.waitForFunction(() => document.querySelector('.ti-go') || document.querySelector('#timeline .tl-node'));
  await page.evaluate(() => document.querySelector('.ti-go')?.click());
  await page.locator('.title-fx').waitFor({ state: 'detached' });
  assert.ok(context.serviceWorkers().some(worker => worker.url().startsWith('chrome-extension://')));
  await page.locator('#pokevin-scripts').click();
  const frame = page.frameLocator('#screen-pokevin-scripts iframe');
  await frame.locator('.monaco-editor').waitFor();
  await frame.getByRole('button', { name: 'Mode Vim', exact: true }).click();
  assert.equal(await frame.locator('#vim').getAttribute('aria-pressed'), 'true');
  await page.keyboard.type('gg0i');
  await frame.locator('#vim-status').getByText('--INSERT--', { exact: true }).waitFor();
  await page.keyboard.type(' ');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code === ' // WXT retained script');
  await page.keyboard.press('u');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code === '// WXT retained script');
  await page.screenshot({ path: path.join(ROOT, 'artifacts/script-vim-mode.png') });
  await frame.getByRole('button', { name: 'Exécuter', exact: true }).click();
  await frame.getByText('Script exécuté.', { exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Arrêter', exact: true }).click();
  await page.evaluate(() => { window.__wxtBeforeReload = true; });
  original = fs.readFileSync(cssFile, 'utf8');
  fs.appendFileSync(cssFile, '\n/* WXT reload test */\n');
  await page.waitForFunction(() => !window.__wxtBeforeReload && !!document.querySelector('#pokevin-scripts'), null, { timeout: 30000 });
  const library = await page.evaluate(() => JSON.parse(localStorage.getItem('pokevin-scripts')));
  assert.ok(library.scripts.some(script => script.code === '// WXT retained script'));
  await page.waitForFunction(() => document.querySelector('.ti-go') || document.querySelector('#timeline .tl-node'));
  await page.evaluate(() => document.querySelector('.ti-go')?.click());
  await page.locator('.title-fx').waitFor({ state: 'detached' });
  await page.locator('#pokevin-scripts').click();
  await frame.locator('.script-row').first().waitFor();
  assert.equal(await frame.locator('#vim').getAttribute('aria-pressed'), 'true');
  await frame.getByRole('button', { name: 'Mode Vim', exact: true }).click();
  assert.equal(await frame.locator('#vim').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('i');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code.includes('i// WXT retained script'));
  await page.keyboard.press('Meta+z');
  const scriptCount = await frame.locator('.script-row').count();
  await frame.locator('.script-row').first().hover();
  await frame.locator('.delete-script').first().click();
  await frame.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await frame.locator('.script-row').count(), scriptCount);
  await frame.locator('.delete-script').first().click();
  await page.keyboard.press('Escape');
  assert.equal(await frame.locator('.script-row').count(), scriptCount);
  await frame.locator('.delete-script').first().click();
  await page.screenshot({ path: path.join(ROOT, 'artifacts/script-delete-confirmation.png') });
  await frame.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await page.waitForFunction(count => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.length === count - 1, scriptCount);
  await frame.locator('#empty:not([hidden])').waitFor();
  await page.locator('#tabs [data-screen="map"]').click();
  await page.locator('#map-root [data-ch="0"]').click();
  await page.waitForFunction(() => /%/.test(document.querySelector('#pc-arena-chance')?.textContent), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#pc-chapter-xp b')?.textContent.includes('≈'), null, { timeout: 30000 });
  fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, 'artifacts/wxt-dev-chrome.png') });
  console.log('WXT: automatic installation, real game, Monaco, script execution, reload, retained scripts and simulations passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (original !== undefined) fs.writeFileSync(cssFile, original);
  await browser?.close();
  if (runner && runner.exitCode === null) { runner.kill('SIGINT'); await once(runner, 'exit'); }
  // Do not remove an existing developer config if the initial assertion failed.
  if (runner) fs.rmSync(config, { force: true });
  fs.rmSync(temporary, { recursive: true, force: true });
});
