// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
require('../ui/chapter-data.js');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const { Game } = globalThis.PokeCatchEngine;
  const { chapters, bundle } = globalThis.PokeCatchChapterData;
  const save = Game.freshState();
  save.trainer = { name: 'Test', sprite: 'red', feats: {} };
  save.adv = { chapter: 2, unlocked: 5, badges: [], gifts: {}, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, runs: 0 };
  save.mons = [1, 4, 7].map((id, i) => ({ ...Game.makeMon(id, 20, { shiny: false }), uid: `preview-${i}` }));
  save.team = save.mons.map(mon => mon.uid);
  save.lastTick = Date.now();
  const shell = await (await fetch('https://pokecatch-online.netlify.app/')).text();
  const fixture = `<!doctype html><html lang="fr"><script src="/bundle/${bundle}"></script>
    <div id="screen-map" class="active"><div id="map-root"></div></div><script>
    window.renderChapter = (chapter, locked = false) => document.querySelector('#map-root').innerHTML =
      '<div class="pg-info"><div class="ch-det"><div class="mp-in"><div class="mp-chips"></div><button class="mp-go" data-go="'+chapter+'" '+(locked?'disabled':'')+'>Continuer</button></div></div></div>';
    renderChapter(0);</script></html>`;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url.startsWith('/bundle/') ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(req.url === '/live' ? shell : req.url.startsWith('/bundle/') ? '' : fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-preview-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, hasTouch: true, viewport: { width: 1920, height: 1080 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  try {
    await context.addInitScript(state => {
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      localStorage.setItem('pokecatch.lang', 'fr');
    }, save);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    const preview = page.locator('#pc-chapter-preview');
    await preview.waitFor();
    const before = await page.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    await preview.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await preview.getAttribute('open'), '');
    assert.match(await preview.innerText(), /Pierre/);
    assert.match(await preview.innerText(), /Assistant d’arène/);
    assert.match(await preview.innerText(), /Dresseurs de route/);
    assert.doesNotMatch(await preview.innerText(), /Onix/, 'Teams belong in the hover bubble');
    assert.equal(await preview.locator('.pc-preview-note').count(), 0);
    const bubble = page.locator('.pc-trainer-tooltip:visible');
    const champion = preview.getByRole('button', { name: 'Pierre · Arène' });
    await champion.hover();
    await bubble.getByText('Onix', { exact: true }).waitFor();
    await bubble.hover();
    assert.equal(await bubble.count(), 1, 'The roster stays open while the pointer crosses into it');
    await page.mouse.move(0, 0);
    await bubble.waitFor({ state: 'hidden' });
    await champion.focus();
    await bubble.waitFor();
    await champion.press('Escape');
    await bubble.waitFor({ state: 'hidden' });
    await preview.getByRole('button', { name: 'Dresseurs de route' }).hover();
    await bubble.getByText('Pokémon possibles', { exact: true }).waitFor();
    assert.match(await bubble.innerText(), /1–2 Pokémon par combat/);
    await page.mouse.move(0, 0);
    const kimonoIndex = chapters.findIndex(chapter => chapter.trainers.some(trainer => trainer.name === 'Kimono Sayo'));
    await page.evaluate(index => renderChapter(index), kimonoIndex);
    await preview.getByText('Kimono Sayo', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await preview.locator('.pc-preview-trainers > li').count(), chapters[kimonoIndex].trainers.length);
    await preview.locator('summary').click();
    await page.evaluate(index => renderChapter(index), kimonoIndex);
    await preview.waitFor();
    assert.equal(await preview.count(), 1, 'Native redraw must remount a single preview');
    const largeChapter = chapters.findIndex(chapter => chapter.trainers.some(trainer => trainer.random && trainer.team.length > 25));
    await page.evaluate(index => renderChapter(index), largeChapter);
    await preview.locator('summary').click();
    const largeEntry = chapters[largeChapter].trainers.findIndex(trainer => trainer.random && trainer.team.length > 25);
    await preview.locator('.pc-preview-trainer').nth(largeEntry).hover();
    const roster = bubble.locator('.pc-preview-roster');
    await roster.waitFor();
    await roster.focus();
    await roster.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.pc-trainer-tooltip:not([hidden]) .pc-preview-roster')?.scrollTop > 0);
    assert.equal(await bubble.count(), 1, 'Scrolling the roster must keep the tooltip open');
    await roster.press('Escape');
    await bubble.waitFor({ state: 'hidden' });
    await page.evaluate(() => renderChapter(0, true));
    await preview.waitFor({ state: 'detached' });
    const empty = chapters.length;
    await page.evaluate(index => renderChapter(index), empty);
    await page.waitForTimeout(300);
    assert.equal(await preview.count(), 0);
    await page.evaluate(() => { renderChapter(0); document.querySelector('script[src]').src = '/bundle/other.js'; });
    await preview.waitFor();
    await preview.locator('summary').click();
    await preview.locator('summary').focus();
    await page.getByRole('tooltip').getByText('Version du jeu différente : les résultats peuvent être inexacts.').waitFor();
    assert.doesNotMatch(await preview.innerText(), /Version du jeu différente/);
    await preview.locator('summary').press('Escape');
    assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), before);
    assert.deepEqual(errors, []);
    console.log('Fixture passed: hover, keyboard, scrollable roster, teams, redraw, chapter switching, locked/empty panels, version warning, no save writes.');

    await page.goto(origin + '/live');
    await page.locator('.title-fx .ti-go').click({ timeout: 30000 });
    await page.locator('.title-fx').waitFor({ state: 'hidden' });
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await preview.locator('summary').click();
    await preview.getByRole('button', { name: 'Assistant d’arène 1' }).hover();
    await bubble.getByText('Onix', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#pc-chapter-preview img')].every(img => img.complete && img.naturalWidth > 0));
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-preview-dark.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await preview.getByRole('button', { name: 'Dresseurs de route' }).hover();
    await bubble.getByText('Pokémon possibles', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-preview-light.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.pg-det-x').click();
    await page.locator('#map-root [data-ch="1"]').click();
    await preview.locator('summary').click();
    const misty = preview.getByRole('button', { name: 'Ondine · Arène' });
    await misty.tap();
    await bubble.getByText('Staross', { exact: true }).waitFor();
    const bounds = await bubble.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await misty.tap();
    await bubble.waitFor({ state: 'hidden' });
    assert.ok(await preview.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    assert.ok(await preview.evaluate(el => el.scrollWidth <= el.clientWidth));
    await preview.locator('summary').press('Enter');
    assert.equal(await preview.getAttribute('open'), null);
    assert.deepEqual(errors, []);
    console.log('Live game passed: hover rosters, mobile tap toggle, native chapter page, portraits loaded, dark/light screenshots at 1920×1080, mobile layout and keyboard.');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
