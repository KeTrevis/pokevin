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
    channel: 'chromium', headless: true, viewport: { width: 1920, height: 1080 },
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
    assert.match(await preview.innerText(), /Onix/);
    assert.equal(await preview.locator('.pc-preview-note').count(), 1, 'Matching bundle needs no warning');
    const kimonoIndex = chapters.findIndex(chapter => chapter.trainers.some(trainer => trainer.name === 'Kimono Sayo'));
    await page.evaluate(index => renderChapter(index), kimonoIndex);
    await preview.getByText('Kimono Sayo', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await preview.locator('.pc-preview-trainers > li').count(), 6);
    await preview.locator('summary').click();
    await page.evaluate(index => renderChapter(index), kimonoIndex);
    await preview.waitFor();
    assert.equal(await preview.count(), 1, 'Native redraw must remount a single preview');
    await page.evaluate(() => renderChapter(0, true));
    await preview.waitFor({ state: 'detached' });
    const empty = chapters.findIndex(chapter => !chapter.trainers.length);
    await page.evaluate(index => renderChapter(index), empty);
    await page.waitForTimeout(300);
    assert.equal(await preview.count(), 0);
    await page.evaluate(() => { renderChapter(0); document.querySelector('script[src]').src = '/bundle/other.js'; });
    await preview.waitFor();
    await preview.locator('summary').click();
    assert.match(await preview.innerText(), /équipes peuvent avoir changé/);
    assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), before);
    assert.deepEqual(errors, []);
    console.log('Fixture passed: teams, keyboard, redraw, chapter switching, locked/empty panels, version warning, no save writes.');

    await page.goto(origin + '/live');
    await page.locator('.title-fx .ti-go').click({ timeout: 30000 });
    await page.locator('.title-fx').waitFor({ state: 'hidden' });
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await preview.locator('summary').click();
    await preview.getByText('Onix', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#pc-chapter-preview img')].every(img => img.complete && img.naturalWidth > 0));
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-preview-dark.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-preview-light.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.pg-det-x').click();
    await page.locator('#map-root [data-ch="1"]').click();
    await preview.locator('summary').click();
    await preview.getByText('Ondine', { exact: true }).waitFor();
    assert.ok(await preview.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    assert.ok(await preview.evaluate(el => el.scrollWidth <= el.clientWidth));
    await preview.locator('summary').press('Enter');
    assert.equal(await preview.getAttribute('open'), null);
    console.log('Live game passed: native chapter page, portraits loaded, dark/light screenshots at 1920×1080, mobile layout and keyboard.');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
