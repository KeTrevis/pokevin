// Run against the downloaded current frontend with the real extension installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');
async function main() {
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'Roaming test', sprite: 'red', feats: {} };
  save.mons = [76, 112, 143].map((id, i) => ({ ...Game.makeMon(id, 100, { shiny: false }), uid: `roaming-${i}` }));
  save.team = save.mons.map(mon => mon.uid);
  save.travel = { to: ['johto'] };
  save.adv = { chapter: 14, unlocked: 25, nodes: [], node: 0, layout: 6, badges: ['Maître Johto'], gifts: { starter: 1, 'starter-johto': 152 }, kept: {}, speed: 1, paused: true, loops: [], runs: 0 };
  save.roam = { at: { 243: { ch: 14, until: Date.now() + 600000 } }, caught: [244, 245, 380, 381, 481] };
  fs.writeFileSync(path.join(ROOT, 'artifacts/roaming-seed.json'), JSON.stringify(save));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-roaming-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    viewport: { width: 1920, height: 1080 }, args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
  try {
    await context.route('**/*supabase.co/**', route => route.abort());
    const page = await context.newPage();
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8080/');
    const open = async (state, chapter = 14) => {
      state.lastTick = Date.now();
      await page.goto(new URL("seed.html", process.env.GAME_URL || "http://127.0.0.1:8080/").href);
      await page.evaluate(state => { state.lastTick = Date.now(); localStorage.setItem('gachamon-save-v1', JSON.stringify(state)); localStorage.setItem('pokecatch.lang', 'fr'); localStorage.setItem('pokecatch-guide-seen', JSON.stringify(['adv', 'catch', 'team', 'league'])); }, state);
      await page.goto(process.env.GAME_URL || "http://127.0.0.1:8080/");
      await page.locator('.ti-go').click();
      await page.locator('.title-fx').waitFor({ state: 'detached' });
      await page.locator('#tabs [data-screen="map"]').click();
      await page.locator(`#map-root [data-ch="${chapter}"]`).click();
      await page.waitForFunction(() => /%/.test(document.querySelector('#pc-arena-chance')?.textContent || ''), null, { timeout: 30000 });
    };
    await open(save);
    const badge = page.locator('#pc-arena-chance');
    assert.equal(await badge.getAttribute('data-champion'), 'Raikou');
    await badge.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Contre Raikou.' }).waitFor();
    const screenshot = path.join(ROOT, 'artifacts/roaming-chance.png');
    await page.screenshot({ path: screenshot });
    const png = fs.readFileSync(screenshot);
    assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    await page.getByRole('button', { name: /Proposer une équipe/ }).first().click();
    await page.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    await page.locator('#map-root [data-ch="15"]').click();
    await page.waitForFunction(() => document.querySelector('.ch-det:not(.det-out) #pc-arena-chance')?.dataset.champion === 'Hector');
    assert.equal(await badge.getAttribute('data-champion'), 'Hector');
    save.roam.caught.push(243); delete save.roam.at[243];
    await open(save);
    assert.notEqual(await badge.getAttribute('data-champion'), 'Raikou');
    await badge.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Contre Albert.' }).waitFor();
    save.roam.caught = save.roam.caught.filter(id => id !== 243);
    save.roam.at[243] = { ch: 20, until: Date.now() + 600000 };
    await open(save, 20);
    assert.equal(await badge.getAttribute('data-champion'), 'Raikou', 'Roaming also gets a chance on a chapter without a gym');
    console.log('Current frontend: roaming chance and optimization, ordinary gym and caught-roamer fallback passed.');
    console.log('Screenshot:', screenshot);
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
