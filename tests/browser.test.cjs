// Optional integration check in a temporary browser profile, never the player's profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const { bundle } = require('../engine/version.json');
require('../engine/core.js');

async function main() {
  const engine = globalThis.PokeCatchEngine;
  const save = engine.Game.freshState();
  save.trainer = { name: 'Test', sprite: 'red', feats: {} };
  save.adv = { chapter: 0, unlocked: 0, badges: [], gifts: {}, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, runs: 0 };
  save.mons = [1, 4, 7, 25, 16, 12].map((id, index) => ({
    ...engine.Game.makeMon(id, 15, { shiny: false }), uid: `browser-${index}`,
  }));
  save.team = save.mons.map(mon => mon.uid);
  const fixture = `<!doctype html><title>Poke’Catch · Test</title>
    <script>localStorage.setItem('gachamon-save-v1',${JSON.stringify(JSON.stringify(save))});localStorage.setItem('pokecatch.lang','fr');
    window.renderChapter = chapter => document.querySelector('#map-root').innerHTML =
      '<div class="pg-info"><div class="mp-det ch-det"><div class="mp-in"><div class="mp-chips"><span>Niveau conseillé</span></div><button class="mp-go" data-go="'+chapter+'">Continuer</button></div></div></div>';
    </script><script src="/fixture/bundle/${bundle}"></script>
    <div id="screen-map" class="screen active"><div id="map-root"></div></div>
    <script>renderChapter(0)</script>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/away') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<p>Temporary navigation test</p>'); }
    else if (req.url === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); }
    else if (req.url === '/fixture/bundle/' + bundle) { res.setHeader('Content-Type', 'text/javascript'); res.end('// Fixture; combat parity is tested separately.'); }
    else {
      const gameRoot = path.resolve(process.env.GAME_DIR || path.join(ROOT, '../game'));
      const filename = path.resolve(gameRoot, '.' + new URL(req.url, 'http://localhost').pathname);
      const resolved = filename === gameRoot ? path.join(gameRoot, 'index.html') : filename;
      if (!resolved.startsWith(gameRoot + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.statusCode = 404; res.end(); return;
      }
      const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
      res.setHeader('Content-Type', mime[path.extname(resolved)] || 'application/octet-stream');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self'");
      fs.createReadStream(resolved).pipe(res);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-coach-test-'));
  let context;
  try {
    const extension = ROOT;
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.BROWSER_EXECUTABLE || undefined,
      headless: true, viewport: { width: 1773, height: 1040 },
      ignoreDefaultArgs: ['--disable-extensions', '--disable-back-forward-cache'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--enable-unsafe-extension-debugging'],
    });
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
    const game = await context.newPage();
    const errors = [];
    game.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.stack); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await game.goto(origin + '/fixture');
    const originalSave = await game.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    const ready = () => game.waitForFunction(() => {
      const badge = document.querySelector('#pc-arena-chance');
      return badge && ['good', 'poor', 'result'].includes(badge.dataset.state);
    }, null, { timeout: 20000 });
    await ready();
    const badge = game.locator('#pc-arena-chance');
    assert.match(await badge.innerText(), /%/);
    assert.equal(await badge.getAttribute('data-champion'), 'Pierre');
    assert.equal(await badge.getAttribute('title'), null, 'Use the styled tooltip instead of the browser title');
    assert.equal(await badge.evaluate(element => element.tagName), 'SPAN');
    assert.equal(await game.evaluate(() => localStorage.getItem('gachamon-save-v1')), originalSave);
    assert.equal(await game.locator('.mp-chips #pc-arena-chance').count(), 1);
    console.log('Inline result:', await badge.innerText());

    await game.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.mons.push({ ...state.mons[0], id: 3, uid: 'pc-strong', level: 50 });
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    const beforeSearch = await game.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    await game.getByRole('button', { name: '✨ Proposer une équipe' }).click();
    await game.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    const advisor = game.locator('#pc-team-advisor');
    assert.match(await advisor.innerText(), /Florizarre/);
    assert.equal(await advisor.locator('.pc-advisor-heading strong').innerText(), '100 %');
    assert.equal(await game.evaluate(() => localStorage.getItem('gachamon-save-v1')), beforeSearch, 'Recommendation must never equip or change Pokémon');
    await game.evaluate(() => renderChapter(0));
    await game.locator('#pc-team-advisor[data-status="result"]').waitFor();
    assert.match(await advisor.innerText(), /Florizarre/, 'Recommendation survives native panel redraws');
    await game.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.mons.find(mon => mon.uid === 'pc-strong').level++;
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    await game.waitForTimeout(2200);
    assert.equal(await advisor.locator('.pc-advisor-stale').count(), 0);
    assert.doesNotMatch(await advisor.innerText(), /Face à|Équipe actuelle|Aucune meilleure composition|Pokémon disponibles|Ta collection/);
    await game.getByRole('button', { name: 'Rechercher à nouveau' }).click();
    await game.getByRole('button', { name: 'Annuler', exact: true }).click();
    await game.locator('#pc-team-advisor[data-status="idle"]').waitFor();
    console.log('Team advisor passed: owned PC recommendation, 100 final trials, no save writes, DOM redraw, compact text and cancellation.');

    await game.evaluate(() => {
      window.calculationStarted = 0;
      window.calculationCompleted = 0;
      window.loadingShown = false;
      new MutationObserver(records => {
        const badge = document.querySelector('#pc-arena-chance');
        if (records.some(record => record.attributeName === 'aria-busy' && record.target === badge)) {
          if (badge.getAttribute('aria-busy') === 'true') window.calculationStarted++;
          else window.calculationCompleted++;
        }
        if (badge?.textContent.includes('Calcul')) window.loadingShown = true;
      }).observe(document.querySelector('#map-root'), { attributes: true, childList: true, characterData: true, subtree: true });
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.money++; state.stats.wins++;
      state.mons[0].hp = 0; state.mons[0].status = 'burn';
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    await game.waitForTimeout(2400);
    assert.equal(await game.evaluate(() => window.calculationStarted), 0, 'Healed-team result should ignore current HP/status and money');
    const injuredSave = await game.evaluate(() => localStorage.getItem('gachamon-save-v1'));
    await badge.click();
    await game.waitForTimeout(500);
    assert.equal(await game.evaluate(() => window.calculationStarted), 0, 'Clicking the badge must not recalculate');
    assert.equal(await game.evaluate(() => localStorage.getItem('gachamon-save-v1')), injuredSave);

    const count = await game.evaluate(() => window.calculationCompleted);
    const previousValue = await badge.locator('b').innerText();
    await game.evaluate(() => {
      window.valueDuringUpdate = null;
      new MutationObserver(() => {
        const badge = document.querySelector('#pc-arena-chance');
        if (badge?.getAttribute('aria-busy') === 'true') window.valueDuringUpdate = badge.querySelector('b').textContent;
      }).observe(document.querySelector('#map-root'), { attributes: true, subtree: true });
    });
    await game.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.mons[0].level++;
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    await game.waitForFunction(before => window.calculationCompleted > before, count);
    await ready();
    assert.equal(await game.evaluate(() => window.loadingShown), false, 'Recalculation must never replace an existing percentage with loading text');
    assert.equal(await game.evaluate(() => window.valueDuringUpdate), previousValue, 'Keep the previous percentage throughout the calculation');
    await game.evaluate(() => { renderChapter(1); });
    await game.waitForTimeout(250);
    await game.evaluate(() => { renderChapter(5); });
    await ready();
    assert.equal(await badge.getAttribute('data-champion'), 'Morgane');
    const result = await badge.innerText();
    await game.evaluate(() => renderChapter(5));
    await ready();
    assert.equal(await badge.innerText(), result, 'DOM redraw should reuse the cached result');
    await game.evaluate(() => { document.querySelector('script[src]').src = '/fixture/bundle/app.other.js'; });
    await game.locator('.pc-advisor-warning').waitFor();
    const completedBeforeMismatch = await game.evaluate(() => window.calculationCompleted);
    await game.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.mons[0].level++;
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    await game.waitForFunction(before => window.calculationCompleted > before, completedBeforeMismatch);
    await ready();
    assert.match(await badge.innerText(), /%/);
    assert.match(await advisor.locator('.pc-advisor-warning').innerText(), /résultats peuvent être inexacts/);
    await game.evaluate(() => renderChapter(0));
    await game.getByRole('button', { name: /Proposer une équipe/ }).click();
    await game.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    assert.equal(await advisor.locator('.pc-advisor-warning').count(), 1, 'Version warning survives optimization');
    await game.evaluate(expected => { document.querySelector('script[src]').src = '/fixture/bundle/' + expected; }, bundle);
    await game.locator('.pc-advisor-warning').waitFor({ state: 'detached' });
    await ready();
    await game.evaluate(() => renderChapter(8));
    await game.waitForTimeout(500);
    assert.equal(await badge.count(), 0, 'No champion percentage on a route without a badge');
    await game.evaluate(() => renderChapter(0));
    await ready();
    assert.deepEqual(errors, []);
    console.log('Inline checks passed: 100 trials, passive badge, silent updates preserving the old result, healed team, cache, navigation races, version mismatch, no save writes.');

    const completedBeforeNavigation = await game.evaluate(() => window.calculationCompleted);
    await game.evaluate(() => {
      window.restoredFromCache = false;
      addEventListener('pageshow', event => { window.restoredFromCache = event.persisted; });
    });
    await game.goto(origin + '/away');
    await game.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.mons.forEach(mon => { mon.level = 100; });
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    await game.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(error => {
      if (!error.message.includes('Timeout')) throw error;
    });
    await game.waitForFunction(() => window.restoredFromCache === true);
    await game.waitForFunction(before => window.calculationCompleted > before, completedBeforeNavigation, { timeout: 20000 });
    await ready();
    assert.equal(await badge.locator('b').innerText(), '100 %');
    assert.equal(await game.locator('#pc-arena-chance').count(), 1);
    await game.evaluate(() => renderChapter(5));
    await game.waitForFunction(() => document.querySelector('#pc-arena-chance')?.dataset.champion === 'Morgane');
    console.log('Browser cache restoration passed: polling, DOM observation and live save reading resume after Back.');

    await game.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      state.adv.chapter = 2; state.adv.unlocked = 5;
      state.lastTick = Date.now();
      state.mons.forEach(mon => { mon.level = mon.uid === 'pc-strong' ? 100 : 30; });
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
    });
    await game.goto(origin + '/');
    await game.locator('#app').waitFor();
    await game.locator('.title-fx .ti-go').click();
    await game.locator('.title-fx').waitFor({ state: 'hidden' });
    await game.locator('#tabs [data-screen="map"]').click();
    await game.locator('#map-root [data-ch="5"]').click();
    await ready();
    assert.equal(await badge.getAttribute('data-champion'), 'Morgane');
    assert.equal(await game.locator('.pg-info .mp-chips #pc-arena-chance').count(), 1);
    const nativeStyle = await game.evaluate(() => {
      const badge = document.querySelector('#pc-arena-chance');
      const native = badge.closest('.mp-chips').querySelector(':scope > span:not(.pg-lv):not(.wx)');
      const properties = ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius'];
      const styles = element => Object.fromEntries(properties.map(property => [property, getComputedStyle(element)[property]]));
      return { badge: styles(badge), native: styles(native) };
    });
    assert.deepEqual(nativeStyle.badge, nativeStyle.native, 'Badge should use the same typography, padding and radius as native chips');
    assert.equal(await badge.locator('small').count(), 0, 'Badge should stay on one line');
    const tooltip = game.locator('.pc-tooltip');
    await badge.hover();
    await tooltip.waitFor({ state: 'visible' });
    assert.equal(await tooltip.innerText(), 'Chance of defeating the Gym Leader, calculated with the current team at 100% HP.');
    assert.equal(await badge.getAttribute('aria-describedby'), await tooltip.getAttribute('id'));
    const tooltipStyle = await game.evaluate(() => {
      const ours = document.querySelector('.pc-tooltip');
      const native = document.querySelector('#map-root .map-head .info-tip-box');
      const properties = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius', 'paddingTop', 'paddingLeft', 'fontSize', 'fontFamily', 'lineHeight'];
      const styles = element => Object.fromEntries(properties.map(property => [property, getComputedStyle(element)[property]]));
      return { ours: styles(ours), native: styles(native) };
    });
    assert.deepEqual(tooltipStyle.ours, tooltipStyle.native, 'Tooltip should use the native surface and typography');
    await game.screenshot({ path: path.join(ROOT, 'coach-tooltip-preview.png') });
    await game.mouse.move(0, 0);
    await tooltip.waitFor({ state: 'hidden' });
    await badge.focus();
    await tooltip.waitFor({ state: 'visible' });
    await badge.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
    await badge.evaluate(element => element.blur());
    const darkBackground = await badge.evaluate(element => getComputedStyle(element).backgroundColor);
    await game.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await game.waitForFunction(dark => getComputedStyle(document.querySelector('#pc-arena-chance')).backgroundColor !== dark, darkBackground);
    await ready();
    await game.screenshot({ path: path.join(ROOT, 'coach-inline-light-preview.png'), fullPage: true });
    await game.evaluate(() => { delete document.documentElement.dataset.theme; });
    await ready();
    await game.screenshot({ path: path.join(ROOT, 'coach-inline-preview.png'), fullPage: true });
    await game.getByRole('button', { name: '✨ Proposer une équipe' }).click();
    await game.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    const resultText = await game.locator('#pc-team-advisor').innerText();
    assert.match(resultText, /Meilleure équipe trouvée/);
    assert.ok(await game.locator('.pc-advisor-team li').count() <= 6);
    assert.equal(await game.locator('.pc-advisor-team img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
    const proposed = await game.locator('.pc-advisor-team li').evaluateAll(items => items.map(item => item.dataset.uid));
    assert.ok(proposed.includes('pc-strong'), 'The recommendation should use the stronger PC Pokémon');
    await game.getByRole('button', { name: 'Appliquer cette équipe', exact: true }).click();
    await game.getByRole('button', { name: 'Équipe appliquée', exact: true }).waitFor();
    const applied = await game.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')));
    assert.deepEqual(applied.team, proposed, 'Apply must change the actual saved team in the proposed order');
    assert.deepEqual(applied.teamSets.list[applied.teamSets.on], proposed, 'Native team preset stays synchronized');
    assert.equal(await badge.getAttribute('data-champion'), 'Morgane');
    await game.locator('#tabs [data-screen="team"]').click();
    assert.deepEqual(await game.locator('#team-slots > .slot.filled').evaluateAll(items => items.map(item => item.dataset.uid)), proposed, 'The live game state must match the save');
    await game.locator('#tabs [data-screen="map"]').click();
    await game.locator('#map-root [data-ch="5"]').click();
    await game.locator('#pc-team-advisor[data-status="result"]').waitFor();
    console.log('Native apply passed: saved team, live state, proposed order, team preset and return to chapter.');
    await game.screenshot({ path: path.join(ROOT, 'coach-team-preview.png'), fullPage: true });
    await game.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await game.screenshot({ path: path.join(ROOT, 'coach-team-light-preview.png'), fullPage: true });
    await game.evaluate(() => { delete document.documentElement.dataset.theme; });
    await game.locator('#map-root [data-ch="1"]').click();
    await ready();
    assert.equal(await badge.getAttribute('data-champion'), 'Ondine');
    assert.equal(await game.locator('.pc-tooltip').count(), 1, 'React must remove the previous panel’s tooltip');
    await game.setViewportSize({ width: 390, height: 844 });
    await game.locator('#map-root .pg-det-x').click();
    await game.locator('#map-root .pg-info.det-open').waitFor({ state: 'detached' });
    await game.locator('#map-root [data-ch="0"]').click();
    await ready();
    assert.equal(await badge.isVisible(), true);
    await game.getByRole('button', { name: '✨ Proposer une équipe' }).click();
    await game.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    assert.equal(await game.locator('#pc-team-advisor').evaluate(element => element.getBoundingClientRect().right <= innerWidth), true);
    await game.screenshot({ path: path.join(ROOT, 'coach-team-mobile-preview.png'), fullPage: true });
    await game.addScriptTag({ path: path.join(ROOT, 'extension/apply-team.js') });
    const nativeApply = await game.evaluate(async () => {
      const read = () => JSON.parse(localStorage.getItem('gachamon-save-v1'));
      const before = read();
      const pc = before.mons.find(mon => !before.team.includes(mon.uid));
      const wanted = [pc.uid, ...before.team.slice(0, 2).reverse()];
      const proposal = wanted.map(uid => { const mon = before.mons.find(mon => mon.uid === uid); return { ...mon, shiny: !!mon.shiny }; });
      document.querySelector('#tabs [data-screen="team"]').click();
      document.querySelector('#pc-type-pop [data-v="fire"]').click();
      document.querySelector('#pc-shiny').click();
      const input = document.querySelector('#pc-search');
      input.value = 'Pikachu'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await PokeCatchTeams.apply(proposal, 0);
      const after = read();
      document.querySelector('#tabs [data-screen="team"]').click();
      const live = [...document.querySelectorAll('#team-slots > .slot.filled')].map(slot => slot.dataset.uid);
      const filters = { search: document.querySelector('#pc-search').value,
        shiny: document.querySelector('#pc-shiny').classList.contains('on'),
        fire: !!document.querySelector('#pc-active [data-clear="type:fire"]') };
      let invalid;
      try { await PokeCatchTeams.apply([{ uid: 'missing', id: 1, shiny: false }], 0); }
      catch (error) { invalid = error.message; }
      return { wanted, saved: after.team, live, filters, invalid, afterInvalid: read().team };
    });
    assert.deepEqual(nativeApply.saved, nativeApply.wanted, 'Native apply adds PC members, reorders and removes excess slots');
    assert.deepEqual(nativeApply.live, nativeApply.wanted);
    assert.deepEqual(nativeApply.filters, { search: 'Pikachu', shiny: true, fire: true }, 'Restore the user’s PC filters');
    assert.match(nativeApply.invalid, /plus disponible/);
    assert.deepEqual(nativeApply.afterInvalid, nativeApply.wanted, 'Reject a missing Pokémon before changing anything');
    assert.deepEqual(errors, []);
    console.log('Original game integration passed: selected champion, native chips, navigation and mobile detail view.');
  } catch (error) {
    console.error('Browser page errors:', context ? await Promise.all(context.pages().map(page => page.evaluate(() => ({ url: location.href, overlays: [...document.querySelectorAll('.cu-veil, #modal-root.open, .title-fx')].map(el => el.textContent.slice(0, 500)) })).catch(() => null))) : []);
    if (context?.pages().at(-1)) await context.pages().at(-1).screenshot({ path: path.join(ROOT, 'coach-test-error.png'), fullPage: true });
    throw error;
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
