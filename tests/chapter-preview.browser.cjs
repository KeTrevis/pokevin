// Run against the downloaded real frontend, served locally (GAME_URL defaults to port 8080).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
require('../ui/chapter-data.js');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'Aperçus test', sprite: 'red', feats: {} };
  save.adv = { chapter: 14, unlocked: 25, badges: ['Maître Johto'], gifts: {starter: 1, 'starter-johto': 152},
    kept: {}, layout: 6, nodes: [], node: 0, loops: [], speed: 1, runs: 0, paused: true };
  save.mons = [1, 4, 7].map((id, i) => ({ ...Game.makeMon(id, 50, { shiny: false }), uid: `preview-${i}` }));
  save.travel = { to: ['johto'] };
  save.team = save.mons.map(mon => mon.uid);
  save.lastTick = Date.now();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-preview-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, hasTouch: true, viewport: { width: 1920, height: 1080 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = process.env.GAME_URL || 'http://127.0.0.1:8080';
    await page.goto(origin + '/seed.html');
    await page.evaluate(state => {
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      localStorage.setItem('pokecatch.lang', 'fr');
      localStorage.setItem('pokecatch-guide-seen', JSON.stringify(['adv','catch','team','league']));
    }, save);
    await page.goto(origin);
    await page.locator('.ti-go').click();
    await page.locator('.title-fx').waitFor({ state: 'hidden' });
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root .rg[data-rg="kanto"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    const preview = page.locator('#pc-chapter-preview');
    await preview.locator('summary').click();
    assert.equal(await preview.locator('.pc-preview-trainer').count(), 1);
    assert.match(await preview.innerText(), /Champions d’arène[\s\S]*Pierre[\s\S]*Roche[\s\S]*Niv. conseillé[\s\S]*Plafond/);
    assert.doesNotMatch(await preview.innerText(), /Assistant|Dresseurs de route|Onix/);
    const champion = preview.getByRole('button', { name: "Pierre · Arène d'Argenta" });
    const bubble = page.locator('.pc-trainer-tooltip:visible');
    await champion.hover();
    await bubble.getByText('Onix', { exact: true }).waitFor();
    await bubble.hover();
    assert.equal(await bubble.count(), 1);
    await page.mouse.move(0, 0);
    await bubble.waitFor({ state: 'hidden' });
    await champion.focus();
    await bubble.waitFor();
    await champion.press('Escape');
    await bubble.waitFor({ state: 'hidden' });
    await champion.blur();
    await page.waitForFunction(() => [...document.querySelectorAll('#pc-chapter-preview img')].every(img => img.complete && img.naturalWidth > 0));
    await champion.hover();
    await bubble.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.pc-trainer-tooltip:not([hidden]) img')].every(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(ROOT, 'artifacts/champions-chrome.png') });

    await page.locator('#map-root .rg[data-rg="johto"]').click();
    await page.locator('#map-root [data-ch="L"]').click();
    await preview.waitFor({ state: 'detached' });
    const rows = page.locator('.lg-mem');
    await rows.first().locator('pc-ui-root').waitFor({ state: 'attached' });
    const names = await rows.locator('.lg-who b').allTextContents();
    assert.equal(names[0], '???');
    const league = PokeCatchChapterData.chapters.filter(ch => ch.league && ch.region === 'johto').flatMap(ch => ch.trainers);
    assert.equal(await rows.count(), league.length);
    for (const [i, trainer] of league.entries()) {
      await page.mouse.move(0, 0);
      await bubble.waitFor({ state: 'hidden' });
      await rows.nth(i).hover();
      await bubble.getByText(`${trainer.name} · ${trainer.location}`, { exact: true }).waitFor();
      assert.equal(await bubble.locator('.pc-preview-team > li').count(), trainer.team.length);
      assert.deepEqual(await bubble.locator('.pc-preview-team b').allTextContents(), trainer.team.map(mon => mon.name));
      await page.waitForTimeout(350);
      assert.equal(await bubble.count(), 1, 'Native redraw must keep the tooltip stable');
    }
    await page.mouse.move(0, 0);
    await bubble.waitFor({ state: 'hidden' });
    await rows.first().focus();
    await bubble.getByText(`${league[0].name} · ${league[0].location}`, {exact:true}).waitFor();
    await rows.first().press('Escape');
    await bubble.waitFor({ state: 'hidden' });
    await rows.first().blur();
    await rows.first().hover();
    await bubble.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.pc-trainer-tooltip:not([hidden]) img')].every(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(ROOT, 'artifacts/league-chrome.png') });
    assert.deepEqual(await rows.locator('.lg-who b').allTextContents(), names, 'Discovery remains unchanged');
    await page.mouse.move(0,0);
    await page.locator('#map-root .rg[data-rg="kanto"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await preview.locator('summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await champion.tap();
    await bubble.getByText('Onix', { exact: true }).waitFor();
    const bounds = await bubble.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
    assert.ok(await preview.evaluate(el => el.scrollWidth <= el.clientWidth));
    await champion.tap();
    await bubble.waitFor({ state: 'hidden' });
    await page.evaluate(bundle => document.querySelector(`script[src$="${bundle}"]`).remove(), PokeCatchChapterData.bundle);
    await page.waitForFunction(() => !document.querySelector('#pc-chapter-preview').open);
    await preview.locator('summary').click();
    await champion.tap();
    await bubble.getByText('Version du jeu différente : les résultats peuvent être inexacts.', { exact: true }).waitFor();
    await bubble.getByText('Onix', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Chrome real game passed: champions only, native cards, ordered League teams including undiscovered, hover, keyboard, touch, redraw stability, mobile bounds, no discovery changes.');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
