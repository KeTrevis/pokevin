// Start the downloaded frontend locally, then set GAME_URL and GAME_SAVE_BUNDLE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const source = fs.readFileSync(process.env.GAME_SAVE_BUNDLE, 'utf8');
  const start = source.indexOf('.SaveWire=function()');
  const end = source.indexOf('(),function()', start);
  assert.ok(start >= 0 && end > start);
  const wire = vm.runInNewContext('(' + source.slice(start + '.SaveWire='.length, end + 2) + ')');
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'Local test', sprite: 'red', feats: {} };
  save.mons = [1, 4, 7, 3].map((id, i) => ({
    ...Game.makeMon(id, i === 3 ? 50 : 10, { shiny: false }), uid: `current-game-${i}`,
  }));
  save.team = save.mons.slice(0, 3).map(mon => mon.uid);
  save.adv = { chapter: 0, unlocked: 0, nodes: [], node: 0, layout: 6,
    badges: [], gifts: { starter: true }, kept: {}, speed: 1, paused: true, loops: [], runs: 0 };
  const packed = wire.pack(save);
  assert.equal(packed.fmt, 2);
  assert.equal(packed.mons, undefined);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-current-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      viewport: { width: 1920, height: 1080 },
      args: [`--disable-extensions-except=${path.join(ROOT, 'dist/extension')}`, `--load-extension=${path.join(ROOT, 'dist/extension')}`] });
    // Keep the local test independent of all live accounts and APIs.
    await context.route('**/*supabase.co/**', route => route.abort());
    const page = await context.newPage();
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8080/');
    await page.evaluate(state => {
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      localStorage.setItem('pokecatch.lang', 'fr');
      localStorage.setItem('pokecatch-guide-seen', JSON.stringify(['adv', 'catch', 'team', 'league']));
    }, packed);
    await page.reload();
    await page.locator('#tabs [data-screen=map]').waitFor();
    if (await page.locator('.title-fx .ti-go').count()) await page.locator('.title-fx .ti-go').click();
    await page.locator('.title-fx').waitFor({ state: 'detached' });
    const sdk = await page.evaluate(async () => {
      const snapshot = pokevin.saves.read();
      const before = JSON.stringify(snapshot);
      const catalog = await pokevin.battles.catalog(snapshot);
      const battle = await pokevin.battles.prepare(snapshot, 0, { now: 1794787200000 });
      const first = await battle.fight(42);
      const second = await battle.fight(42);
      let wins = 0;
      for (let run = 0; run < 5; run++) wins += Number((await battle.fight()).won);
      battle.close();
      let closed;
      try { await battle.fight(); } catch (error) { closed = error.message; }
      const stopped = await pokevin.battles.prepare(snapshot, catalog.champions[0].id);
      stopped.close();
      let stoppedError;
      try { await stopped.fight(); } catch (error) { stoppedError = error.message; }
      return { first, second, probability: wins / 5, closed, stoppedError,
        unchanged: JSON.stringify(snapshot) === before, bundle: catalog.bundle };
    });
    assert.deepEqual(sdk.first, sdk.second);
    assert.ok(sdk.probability >= 0 && sdk.probability <= 1);
    assert.match(sdk.closed, /fermée/);
    assert.match(sdk.stoppedError, /fermée/);
    assert.equal(sdk.unchanged, true);
    assert.equal(sdk.bundle, require('../engine/version.json').bundle);
    const loaded = await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')));
    const compact = wire.pack(wire.unpack(loaded));
    assert.equal(compact.fmt, 2);
    await page.evaluate(state => localStorage.setItem('gachamon-save-v1', JSON.stringify(state)), compact);
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    const xp = page.locator('#pc-chapter-xp');
    await page.waitForFunction(() => document.querySelector('#pc-chapter-xp b')?.textContent.includes('≈'));
    await page.waitForFunction(() => /%/.test(document.querySelector('#pc-arena-chance')?.textContent));
    await xp.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Vitesse effective' }).waitFor();
    assert.doesNotMatch(await page.getByRole('tooltip').filter({ hasText: 'Vitesse effective' }).innerText(), /Version du jeu différente/);
    assert.doesNotMatch(await xp.innerText(), /Indisponible/);
    const before = wire.unpack(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1'))));
    await page.getByRole('button', { name: /Proposer une équipe/ }).click();
    await page.locator('#pc-team-advisor[data-status="result"]').waitFor({ timeout: 60000 });
    const searched = wire.unpack(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1'))));
    assert.deepEqual(searched.team, before.team, 'Searching must not equip the proposal while the real game ticks');
    await page.getByRole('button', { name: 'Appliquer cette équipe' }).click();
    await page.getByRole('button', { name: 'Équipe appliquée' }).waitFor();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')));
    assert.ok(after.team.includes('current-game-3'));
    // The game itself must still own encoding and persistence after native team edits.
    const decoded = wire.unpack(after);
    assert.ok(decoded.mons.some(mon => mon.uid === 'current-game-3'));
    assert.deepEqual(decoded.team, after.team);
    await page.waitForFunction(() => document.querySelector('#pc-chapter-xp b')?.textContent.includes('≈'));
    await xp.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Vitesse effective' }).waitFor();
    assert.doesNotMatch(await page.getByRole('tooltip').filter({ hasText: 'Vitesse effective' }).innerText(), /Version du jeu différente/);
    const screenshot = path.join(ROOT, 'artifacts/current-game-save-fixed.png');
    await page.evaluate(() => Promise.all([...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width && rect.height && rect.top < innerHeight && rect.bottom > 0;
    }).map(image => {
      image.loading = 'eager';
      return image.decode().catch(() => {});
    })));
    await page.screenshot({ path: screenshot });
    const png = fs.readFileSync(screenshot);
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
    // The chapter UI is generic: scripts own their text, color and lifecycle.
    await page.evaluate(() => {
      globalThis.customBadge = pokevin.ui.chapterBadge(0, {
        id: 'custom-chapter-badge', text: '<b>Mon XP/h</b>', color: '#123456', tooltip: 'Mon tooltip',
      });
    });
    const custom = page.locator('#custom-chapter-badge');
    assert.equal(await custom.innerText(), '<b>Mon XP/h</b>');
    assert.equal(await custom.locator('b').evaluate(node => getComputedStyle(node).color), 'rgb(18, 52, 86)');
    await custom.focus();
    await page.getByRole('tooltip').filter({hasText:'Mon tooltip'}).waitFor();
    await custom.press('Escape');
    await page.evaluate(() => customBadge.update({text:'XP/h : 123', color:'#42c978'}));
    assert.equal(await custom.innerText(), 'XP/h : 123');
    await page.evaluate(() => customBadge.remove());
    assert.equal(await custom.count(), 0);

    await page.evaluate(() => {
      globalThis.visits = [];
      globalThis.offVisit = pokevin.chapters.onViewed(async (view, scope) => {
        if (!view) return;
        const visit = { scope, badge: scope.ui.chapterBadge(view.chapterId, { id: 'visit-badge', text: 'Pending' }) };
        visits.push(visit);
        visit.battle = await scope.battles.prepare(pokevin.saves.read(), view.chapterId);
        await new Promise(resolve => { visit.finish = resolve; });
        visit.badge.update({ text: 'Finished' });
      });
    });
    await page.waitForFunction(() => visits[0]?.finish);
    await page.locator('#pokevin-scripts').click();
    await page.waitForFunction(() => !document.querySelector('#visit-badge'));
    const cancelled = await page.evaluate(async () => {
      const old = visits[0];
      const errors = [];
      try { await old.battle.fight(); } catch (error) { errors.push(error.message); }
      try { await old.scope.battles.prepare(pokevin.saves.read(), 0); } catch (error) { errors.push(error.message); }
      return errors;
    });
    assert.match(cancelled[0], /fermée/); assert.match(cancelled[1], /arrêté/);
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await page.waitForFunction(() => visits[1]?.finish);
    await page.evaluate(() => visits[0].finish());
    assert.equal(await page.locator('#visit-badge').innerText(), 'Pending');
    await page.evaluate(() => visits[1].finish());
    await page.waitForFunction(() => document.querySelector('#visit-badge')?.textContent === 'Finished');
    await page.evaluate(() => offVisit());
    assert.equal(await page.locator('#visit-badge').count(), 0);

    await page.locator('#pokevin-scripts').click();
    const frame = page.frameLocator('#screen-pokevin-scripts iframe');
    await frame.getByRole('button', {name:'Arrêter', exact:true}).click();
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#pc-arena-chance').count(), 0, 'Stopping the listed script removes the real badge');
    assert.equal(await page.locator('#pc-chapter-xp').count(), 1);

    await page.locator('#pokevin-scripts').click();
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code);
    assert.match(original,/async function updateVictoryBadge/);
    assert.ok((await frame.locator('.view-lines').innerText()).length > 100, 'The bundled source remains readable');
    assert.equal(await frame.locator('.squiggly-error').count(), 0, 'The bundled script has no editor type errors');
    assert.equal(await frame.getByRole('textbox', {name:'Nom du script'}).getAttribute('readonly'),null);
    assert.equal(await frame.locator('.delete-script').count(),4);
    assert.equal(await frame.locator('.script-group').count(),0);
    const edited = original + '// My editable indicator';
    await frame.locator('.monaco-editor textarea').focus();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.insertText('// My editable indicator');
    await frame.getByRole('textbox', {name:'Nom du script'}).fill('Mon indicateur');
    await page.waitForFunction(code => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code.replace(/\s+/g,'') === code.replace(/\s+/g,''), edited);
    await frame.getByRole('button', {name:'Exécuter', exact:true}).click();
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await page.waitForFunction(() => /Victoire .*%/.test(document.querySelector('#pc-arena-chance')?.textContent));
    await page.locator('#pokevin-scripts').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#screen-pokevin-scripts')).opacity === '1');
    const editorScreenshot = path.join(ROOT, 'artifacts/scripts-editable.png');
    await page.screenshot({path:editorScreenshot});
    const editorPNG = fs.readFileSync(editorScreenshot);
    assert.equal(editorPNG.readUInt32BE(16),1920); assert.equal(editorPNG.readUInt32BE(20),1080);
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:1920,height:1080});
    await frame.locator('.script-row').first().hover();
    await frame.getByRole('button', {name:'Supprimer Mon indicateur',exact:true}).click();
    await frame.getByRole('button', {name:'Supprimer',exact:true}).click();
    await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.some(script=>script.id==='example-victory-chance'));
    await page.evaluate(() => pokevin.stop());
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#pc-arena-chance').count(), 0);
    await page.reload();
    await page.locator('#tabs [data-screen=map]').waitFor();
    if (await page.locator('.title-fx .ti-go').count()) await page.locator('.title-fx .ti-go').click();
    await page.locator('.title-fx').waitFor({state:'detached'});
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#pc-arena-chance').count(), 0, 'Stopped state survives reload');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.some(script=>script.id==='example-victory-chance')),false,'Deleted default stays deleted after reload');
    const leagueSave = structuredClone(save);
    Object.assign(leagueSave.adv, { chapter: 9, unlocked: 9, nodes: [], node: 0, battle: null, pending: null, paused: true });
    await page.goto(new URL('/seed.html', process.env.GAME_URL || 'http://127.0.0.1:8080/').href);
    await page.evaluate(state => {
      state.lastTick = Date.now();
      localStorage.setItem('gachamon-save-v1', JSON.stringify(state));
      localStorage.removeItem('pokevin-scripts');
    }, wire.pack(leagueSave));
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8080/');
    await page.locator('#tabs [data-screen=map]').waitFor();
    if (await page.locator('.title-fx .ti-go').count()) await page.locator('.title-fx .ti-go').click();
    await page.locator('.title-fx').waitFor({state:'detached'});
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="L"]').click();
    await page.waitForFunction(() => document.querySelector('#pc-arena-chance')?.dataset.champion === 'Ligue entière');
    assert.match(await page.locator('#pc-arena-chance').innerText(), /Victoire .*%/);
    await page.locator('#pc-arena-chance').hover();
    await page.locator('#pc-arena-chance').focus();
    await page.getByRole('tooltip').filter({hasText:'Ligue entière'}).waitFor();
    await page.screenshot({path:path.join(ROOT, 'artifacts/league-victory-chrome.png')});
    const leaguePNG = fs.readFileSync(path.join(ROOT, 'artifacts/league-victory-chrome.png'));
    assert.equal(leaguePNG.readUInt32BE(16),1920); assert.equal(leaguePNG.readUInt32BE(20),1080);
    await page.locator('#pc-arena-chance').press('Escape');
    await page.locator('#pokevin-scripts').click();
    await frame.getByRole('button', {name:'Arrêter',exact:true}).click();
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="L"]').click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#pc-arena-chance').count(),0);
    await page.locator('#pokevin-scripts').click();
    await frame.getByRole('button', {name:'Calculateur d’XP',exact:true}).click();
    await page.waitForTimeout(1500);
    assert.equal(await frame.locator('.squiggly-error').count(),0,'XP source is typed in Monaco');
    await page.screenshot({path:path.join(ROOT,'artifacts/xp-builtin-source-chrome.png')});
    await frame.getByRole('button', {name:'Arrêter',exact:true}).click();
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="L"]').click();
    await page.waitForTimeout(300);
    assert.equal(await xp.count(),0,'Stopping the XP script removes its badge');
    await page.reload();
    await page.locator('#tabs [data-screen="map"]').waitFor();
    if (await page.locator('.title-fx .ti-go').count()) await page.locator('.title-fx .ti-go').click();
    await page.locator('.title-fx').waitFor({state:'detached'});
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="L"]').click();
    await page.waitForTimeout(300);
    assert.equal(await xp.count(),0,'XP stays stopped after reload');
    await page.locator('#pokevin-scripts').click();
    await frame.getByRole('button', {name:'Exécuter',exact:true}).click();
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="L"]').click();
    await page.waitForFunction(()=>document.querySelector('#pc-chapter-xp')?.textContent.includes('≈'));
    await xp.focus();
    await page.screenshot({path:path.join(ROOT,'artifacts/xp-builtin-league-chrome.png')});
    console.log('League badge: full Kanto circuit calculated by the listed script, tooltip and stop passed.');
    console.log('SDK chapter badges: custom text/color, tooltip, update/remove, editable defaults, rename/delete persistence and stop/reload passed.');
    console.log('Current frontend: synchronized engine, compact save, XP/h, gym chance, optimization and native team application passed.');
    console.log('Screenshot:', screenshot);
  } catch (error) {
    const page = context?.pages().at(-1);
    if (page) {
      console.error('Modal at failure:', await page.locator('#modal-root').innerText().catch(() => 'Unavailable'));
      await page.screenshot({path: path.join(ROOT, 'artifacts/current-game-failure.png')}).catch(() => {});
    }
    throw error;
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
