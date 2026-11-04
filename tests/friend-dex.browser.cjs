// PLAYWRIGHT_MODULE=/path/to/playwright node tests/friend-dex.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const UID = '11111111-2222-4333-8444-555555555555';
const SESSION = 'sb-qglircqqrtgdvxawisoz-auth-token';

async function main() {
  const fixture = `<!doctype html><html lang="fr"><head>
    <base href="https://pokecatch-online.pages.dev/">
    <link rel="stylesheet" href="bundle/app.f8b2479bdb.css"></head><body>
    <main style="max-width:1000px;margin:60px auto;padding:24px">
      <div id="screen-friends" class="active"><div class="map-region fr">
        <div class="map-head"><h2>Amis</h2></div><div class="mp-list fr-list">
          <div class="mp-row fr-row" data-fr-open="${UID}" role="button" tabindex="0">
            <span class="fr-face"><img src="assets/trainers/leaf.png" alt=""></span>
            <span class="t"><b>Ondine<span class="tag">#1234</span></b><small>8 badges · 6 au Pokédex</small></span>
            <span class="lv"></span>
          </div></div></div></div>
    </main><div id="modal-root" class="modal-root" hidden></div><script>
      window.nativeClicks = 0;
      document.querySelector('[data-fr-open]').onclick = () => {
        nativeClicks++;
        const modal = document.querySelector('#modal-root');
        modal.hidden = false; modal.classList.add('open');
        modal.innerHTML = '<div class="modal dexcard-modal tc-modal"><div class="modal-body"><div class="tc">' +
          '<div class="dc-head"><h2>Carte d’ami</h2><button class="tc-x dc-x" aria-label="Fermer la carte">✕</button></div>' +
          '<div class="tc-id"><div class="tc-idl"><span class="dc-hero tc-portrait ro"><img class="tr" src="assets/trainers/leaf.png" alt=""></span></div>' +
          '<div class="tc-info"><div class="tc-name"><b>Ondine<small class="tag">#1234</small></b></div>' +
          '<div class="dc-facts two"><div class="dc-fact"><small>Dresseur depuis</small><b>23/10/2026</b></div><div class="dc-fact"><small>Temps de jeu</small><b>16 h 46</b></div></div>' +
          '<div class="tc-dex"><div class="tc-ring" style="--p:4"><div><span><b>4%</b></span></div></div>' +
          '<div class="tc-dex-txt"><b>6 / 151 capturés</b><p class="shiny">✦ 0 chromatiques capturés</p></div></div></div></div>' +
          '<div class="dc-sec"><h4>Équipe</h4><div class="tc-team">' + [1,4,7,25,54,130].map(id => '<span class="dc-hero tc-mon"><img src="assets/pokemon/'+id+'.png" alt=""></span>').join('') + '</div></div>' +
          '</div></div><div class="modal-actions"><button class="btn outline">Retirer de mes amis</button></div></div>';
        modal.querySelector('.tc-x').onclick = () => { modal.hidden = true; modal.classList.remove('open'); modal.innerHTML = ''; };
      };
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') document.querySelector('.tc-x')?.click();
      });
    </script></body></html>`;
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-friend-dex-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 1920, height: 1080 },
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ key }) => {
      localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-session' }));
      localStorage.setItem('gachamon-save-v1', '{"untouched":true}');
    }, { key: SESSION });
    let status = 200, card = { dex: [1, 4, 7, 25, 54, 130] }, calls = 0;
    await context.route('**/rest/v1/rpc/friend_card', async route => {
      calls++;
      assert.equal(route.request().method(), 'POST');
      assert.deepEqual(route.request().postDataJSON(), { other: UID });
      assert.equal(route.request().headers().authorization, 'Bearer fixture-session');
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(card),
        headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.getByRole('button', { name: 'Voir son Pokédex', exact: true }).count(), 0);
    await page.locator('[data-fr-open]').click();
    const open = page.getByRole('button', { name: 'Voir son Pokédex', exact: true });
    await open.waitFor();
    assert.equal(await page.locator('.tc-name [data-pc-friend-dex]').count(), 1);
    assert.equal(await page.locator('[data-fr-open] [data-pc-friend-dex]').count(), 0);
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    assert.equal(await open.textContent(), '');
    await open.locator('img').evaluate(img => img.decode());
    await page.screenshot({ animations: 'disabled', path: path.join(ROOT, 'artifacts/friend-card-pokedex.png') });
    await open.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Pokédex de Ondine' }).waitFor();
    await dialog.getByText('6 espèces capturées', { exact: false }).waitFor();
    assert.ok(await dialog.locator('li').count() > 493);
    assert.equal(await dialog.locator('.caught').count(), 6);
    assert.ok(await dialog.locator('.seen img').count() > 0);
    assert.equal(await dialog.getByRole('combobox').count(), 0);
    assert.equal(await page.evaluate(() => nativeClicks), 1);
    await dialog.getByRole('searchbox').fill('Pikachu');
    assert.equal(await dialog.locator('.caught').count(), 1);
    await dialog.getByRole('searchbox').fill('#25');
    assert.equal(await dialog.locator('.caught').count(), 1);
    await dialog.getByRole('searchbox').fill('#001');
    assert.equal(await dialog.locator('li').count(), 1);
    await dialog.getByRole('searchbox').fill('zzzzzz');
    await dialog.getByText('Aucun Pokémon à afficher.').waitFor();
    await dialog.getByRole('searchbox').fill('Herbizarre');
    assert.equal(await dialog.locator('.seen').count(), 1);
    await dialog.getByRole('searchbox').fill('');
    const firstRegion = dialog.locator('.dex-region').first();
    await firstRegion.locator('summary').click();
    assert.equal(await firstRegion.getAttribute('open'), null);
    await firstRegion.locator('summary').press('Enter');
    assert.notEqual(await firstRegion.getAttribute('open'), null);
    await page.waitForFunction(() => [...document.querySelectorAll('#pc-friend-dex img')].slice(0, 10).every(img => img.complete));
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    await page.screenshot({ animations: 'disabled', path: path.join(ROOT, 'artifacts/friend-dex-dark.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({ animations: 'disabled', path: path.join(ROOT, 'artifacts/friend-dex-light.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await open.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('.tc-modal:visible').count(), 1, 'Escape preserves the underlying friend card');

    // Both native row navigation and extension keyboard access must remain independent.
    await open.press('Enter');
    await dialog.getByText('6 espèces capturées', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    assert.equal(await page.evaluate(() => nativeClicks), 1);

    status = 401;
    await open.click();
    await dialog.getByRole('alert').getByText('Session expirée.', { exact: false }).waitFor();
    status = 200;
    card = { dex: [25, '25', 99999] };
    await dialog.getByRole('button', { name: 'Réessayer' }).click();
    await dialog.getByText('2 espèces capturées', { exact: false }).waitFor();
    await dialog.getByRole('listitem', { name: 'Pokémon #99999 · Capturé', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    card = { dex: ['unexpected'] };
    await open.click();
    await dialog.getByRole('alert').getByText('Pokédex inaccessible', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    const before = calls;
    await page.evaluate(key => localStorage.removeItem(key), SESSION);
    await open.click();
    await dialog.getByRole('alert').getByText('Connecte-toi au jeu', { exact: false }).waitFor();
    assert.equal(calls, before);
    assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), '{"untouched":true}');
    assert.deepEqual(errors, []);
    console.log('Friend Pokédex passed: icon beside trainer name, extension worker, authenticated request, native region grids, no filter controls, search, keyboard, mobile, themes, retry, expired/missing session, malformed response, future species, no save writes.');
  } finally {
    await context?.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
