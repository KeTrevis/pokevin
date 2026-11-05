// Run with PLAYWRIGHT_MODULE and GAME_DIR, like browser.test.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');
const { bundle } = require('../engine/version.json');

async function main() {
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.mons = [1, 4, 7].map((id, i) => ({ ...Game.makeMon(id, 10, { shiny: false }), uid: `xp-browser-${i}` }));
  save.team = save.mons.map(mon => mon.uid);
  save.adv = { chapter: 0, unlocked: 9, nodes: [], node: 0, layout: 6,
    badges: ['Roche'], gifts: { starter: true }, kept: {}, speed: 1 };
  const gameDir = process.env.GAME_DIR || path.join(ROOT, '../game');
  const styles = fs.readdirSync(path.join(gameDir, 'bundle')).filter(file => file.endsWith('.css'));
  const fixture = `<!doctype html><html lang="fr" data-theme="dark"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Poke’Catch · XP/h</title>${styles.map(file => `<link rel="stylesheet" href="/bundle/${file}">`).join('')}
    <script src="/bundle/${bundle}"></script>
    <main id="screen-map" class="screen active"><div id="map-root"></div></main>
    <script>window.renderChapter = (chapter, locked = false) => document.querySelector('#map-root').innerHTML =
      '<div class="pg-info"><div class="mp-det ch-det"><div class="mp-in"><h2>Chapitre '+(chapter+1)+' · '+(chapter===0?'Argenta':'Aventure')+'</h2><div class="mp-chips"><span>Niveau conseillé 15</span></div><button class="mp-go" data-go="'+chapter+'" '+(locked?'disabled':'')+'>Continuer</button></div></div></div>';
      renderChapter(0);</script></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
    if (req.url === '/bundle/' + bundle) { res.setHeader('Content-Type', 'text/javascript'); res.end('// Engine version marker'); return; }
    const file = path.resolve(gameDir, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(path.resolve(gameDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-xp-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      viewport: { width: 1920, height: 1080 },
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.requests = [];
      chrome.runtime.onConnect.addListener(port => port.onMessage.addListener(message => {
        if (['xp', 'run'].includes(message.type)) globalThis.requests.push({ type: message.type, chapter: message.chapter });
      }));
    });
    const requests = () => worker.evaluate(() => globalThis.requests);
    await context.addInitScript(state => localStorage.setItem('gachamon-save-v1', JSON.stringify(state)), save);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const badge = page.locator('#pc-chapter-xp');
    const ready = () => page.waitForFunction(() => document.querySelector('#pc-chapter-xp b')?.textContent.startsWith('≈'), null, { timeout: 20000 });
    await ready();
    const originalSave = await page.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    assert.equal(originalSave, JSON.stringify(save));
    await badge.focus();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor();
    assert.match(await tooltip.innerText(), /Vitesse effective ×1/);
    assert.doesNotMatch(await tooltip.innerText(), /XP de combat totale|Cadence nominale|animations et pauses/);
    await page.waitForFunction(() => document.querySelector('#pc-arena-chance')?.getAttribute('aria-busy') === 'false');
    const initialRequests = await requests();
    assert.equal(initialRequests.filter(request => request.type === 'xp').length, 1);
    assert.equal(initialRequests.filter(request => request.type === 'run').length, 1);
    const initialXP = await badge.innerText();
    const initialChance = await page.locator('#pc-arena-chance').innerText();
    await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      save.adv.speed = 4; save.mons[0].xp += 10; save.mons[0].level++;
      save.items = { potion: 3 }; save.trainer = { feats: { test: true } };
      save.dex[25] = true;
      localStorage.setItem('gachamon-save-v1', JSON.stringify(save));
      renderChapter(0); // The game may redraw the current panel while farming.
    });
    await page.waitForTimeout(2300); // Exercise the normal polling pass too.
    await ready();
    assert.deepEqual(await requests(), initialRequests, 'Progress, loot, speed and redraw do not restart either estimate');
    assert.equal(await badge.innerText(), initialXP);
    assert.equal(await page.locator('#pc-arena-chance').innerText(), initialChance);
    await page.locator('#pc-chapter-xp').focus();
    assert.match(await page.getByRole('tooltip').innerText(), /Vitesse effective ×1/);
    await page.evaluate(() => document.querySelector('#map-root').innerHTML = '');
    await page.waitForTimeout(200);
    await page.evaluate(() => renderChapter(0));
    await ready();
    await page.waitForFunction(() => document.querySelector('#pc-arena-chance')?.getAttribute('aria-busy') === 'false');
    assert.equal((await requests()).filter(request => request.type === 'xp').length, 2);
    assert.equal((await requests()).filter(request => request.type === 'run').length, 2);
    await badge.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Vitesse effective ×2.5')));
    const changedSave = await page.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-xp-dark.png') });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-xp-light.png') });
    await badge.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await badge.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    await page.evaluate(() => renderChapter(1));
    await ready();
    assert.match(await badge.innerText(), /≈/, 'A losing team can estimate a chapter with unclaimed gifts');
    assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), changedSave);
    await page.evaluate(() => renderChapter(8));
    await ready();
    assert.equal(await page.locator('#pc-arena-chance').count(), 0, 'XP/h also works without a gym badge');
    await page.evaluate(() => renderChapter(8, true));
    await badge.waitFor({ state: 'detached' });
    await page.evaluate(() => renderChapter(0));
    await ready();
    assert.equal(await badge.count(), 1, 'Redraw uses one cached result');
    assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), changedSave);
    await page.evaluate(() => document.querySelector('script[src]').src = '/bundle/app.other.js');
    await badge.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Version du jeu différente')));
    await ready();
    // Only reopening the page refreshes the calculation, even with a version warning.
    const beforeMutation = await requests();
    await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      save.mons[0].level++;
      localStorage.setItem('gachamon-save-v1', JSON.stringify(save));
    });
    await page.waitForTimeout(2300);
    assert.deepEqual(await requests(), beforeMutation);
    await page.evaluate(() => document.querySelector('#map-root').innerHTML = '');
    await page.waitForTimeout(200);
    await page.evaluate(() => renderChapter(0));
    await ready();
    await badge.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Version du jeu différente')));
    await badge.press('Escape');
    const chance = page.locator('#pc-arena-chance');
    await chance.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Version du jeu différente')));
    assert.match(await chance.innerText(), /%/);
    await chance.press('Escape');
    const search = page.getByRole('button', { name: /Proposer une équipe/ });
    await search.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Version du jeu différente')));
    await search.click();
    await page.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    const apply = page.getByRole('button', { name: 'Appliquer cette équipe' });
    assert.equal(await apply.isEnabled(), true);
    await apply.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Version du jeu différente')));
    await apply.press('Escape');
    const summary = page.locator('#pc-chapter-preview summary');
    await summary.focus();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes('Version du jeu différente')));
    await summary.press('Enter');
    assert.equal(await page.locator('#pc-chapter-preview').getAttribute('open'), '');
    await summary.press('Escape');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.screenshot(); // Finish the resize paint before opening its tooltip.
    await page.locator('.mp-go').focus();
    await badge.focus();
    await badge.hover();
    await page.waitForFunction(() => {
      const tooltip = document.getElementById(document.querySelector('#pc-chapter-xp')?.getAttribute('aria-describedby'));
      return tooltip?.textContent.includes('Version du jeu différente');
    });
    await page.getByRole('tooltip').filter({ hasText: 'Vitesse effective' }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/chapter-version-warning.png') });
    await page.evaluate(expected => document.querySelector('script[src]').src = '/bundle/' + expected, bundle);
    await page.waitForFunction(() => {
      const tooltip = document.getElementById(document.querySelector('#pc-chapter-xp')?.getAttribute('aria-describedby'));
      return tooltip && !tooltip.textContent.includes('Version du jeu différente');
    });
    await ready();
    // Native League and zone panels have .mp-det without .ch-det.
    const specialTeam = [76, 112, 143, 248, 3, 9].map((id, index) => ({
      ...Game.makeMon(id, index === 5 ? 10 : 100, { shiny: true }), rank: 5, uid: `special-${index}`,
    }));
    await page.evaluate(mons => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.mons = mons; state.team = mons.map(mon => mon.uid); state.road = [...state.team];
      state.adv.badges = ['Maître', 'Maître Johto', 'Maître Hoenn', 'Maître Sinnoh'];
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    }, specialTeam);
    for (const region of PokeCatchEngine.STORY.REGIONS.filter(region => region.key)) {
      const chapter = PokeCatchEngine.STORY.CHAPTERS.findIndex((entry, index) => entry.league && PokeCatchEngine.STORY.regionOf(index).key === region.key);
      await page.evaluate(({ region, chapter }) => {
        const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
        state.adv.chapter = chapter; state.adv.unlocked = chapter;
        state.travel = { to: ['kanto', 'johto', 'hoenn', 'sinnoh'] };
        localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
        renderChapter('L');
        document.querySelector('.mp-det').classList.remove('ch-det');
        document.querySelector('h2').textContent = 'Ligue · ' + region.name;
        document.querySelector('#map-root').insertAdjacentHTML('afterbegin', '<button class="rg active" data-rg="' + region.key + '">' + region.name + '</button>');
      }, { region, chapter });
      const snapshot = await page.evaluate(() => localStorage.getItem('gachamon-save-v1'));
      await ready();
      assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), snapshot);
      assert.doesNotMatch(await badge.innerText(), /≈ 0$/);
      assert.equal((await requests()).at(-1).chapter, `league:${region.key}`);
      await badge.focus();
      await page.getByRole('tooltip').filter({ hasText: 'Ligue entière.' }).waitFor();
      assert.equal(await page.locator('#pc-arena-chance').count(), 0);
      if (region.key === 'kanto') {
        await page.screenshot({ path: path.join(ROOT, 'artifacts/league-xp.png') });
        const count = (await requests()).length;
        await page.waitForTimeout(2300);
        assert.equal((await requests()).length, count, 'League results remain cached during a visit');
      }
      await badge.press('Escape');
    }
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.adv.chapter = 4; state.adv.unlocked = 13;
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      renderChapter(0);
      document.querySelector('.mp-det').classList.remove('ch-det');
      document.querySelector('h2').textContent = 'Zone légendaire · Électhor';
      const button = document.querySelector('.mp-go');
      button.removeAttribute('data-go'); button.dataset.zone = '145';
      const chips = document.querySelector('.mp-chips');
      const hunt = document.createElement('div'); hunt.className = 'ev-hunt';
      chips.replaceWith(hunt); hunt.append(chips);
    });
    await ready();
    assert.equal((await requests()).at(-1).chapter, 'zone:145');
    await badge.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Vitesse effective' }).waitFor();
    const zoneShot = path.join(ROOT, 'artifacts/zone-xp.png');
    await page.screenshot({ path: zoneShot });
    for (const file of ['league-xp.png', 'zone-xp.png']) {
      const png = fs.readFileSync(path.join(ROOT, 'artifacts', file));
      assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    }
    await badge.press('Escape');
    await page.evaluate(() => document.querySelector('.mp-go').disabled = true);
    await badge.waitFor({ state: 'detached' });
    await page.evaluate(() => {
      document.querySelector('.mp-go').removeAttribute('data-zone');
      document.querySelector('.mp-det').setAttribute('data-evt-id', '145');
    });
    assert.equal(await badge.count(), 0, 'Events without combat XP have no farming estimate');
    assert.deepEqual(errors, []);
    console.log('XP/h browser: real extension, one calculation per visit, no refresh on progress/speed/loot/redraw, reopening, keyboard tooltip, no-gym chapter, four regional leagues, legendary zones, locks, cache, version mismatch, mobile, no save writes. Screenshots: 1920×1080.');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
