// Real Firefox, temporary profile, synthetic save; Node 22+, no driver dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const ROOT = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
require('../engine/core.js');

async function main() {
  const { Game } = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'Firefox test', sprite: 'red', feats: {} };
  save.adv = { chapter: 0, unlocked: 0, badges: [], gifts: { starter: true }, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, runs: 0 };
  save.mons = [1, 4, 7, 25, 16, 12, 3, 19, 21].map((id, i) => ({
    ...Game.makeMon(id, i === 6 ? 50 : 15, { shiny: false }), uid: `firefox-${i}`,
  }));
  save.team = save.mons.slice(0, 6).map(mon => mon.uid);
  const gameRoot = path.resolve(process.env.GAME_DIR || path.join(ROOT, '../game'));
  const server = http.createServer((req, res) => {
    if (req.url === '/seed') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Test fixture</title>'); return; }
    const filename = path.resolve(gameRoot, '.' + new URL(req.url, 'http://localhost').pathname);
    const file = filename === gameRoot ? path.join(gameRoot, 'index.html') : filename;
    if (!file.startsWith(gameRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecatch-firefox-test-'));
  fs.writeFileSync(path.join(profile, 'user.js'), 'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\n');
  let browser, socket, command;
  try {
    const executable = process.env.FIREFOX_EXECUTABLE || (process.platform === 'darwin' ?
      '/Applications/Firefox.app/Contents/MacOS/firefox' : process.platform === 'win32' ?
        'C:/Program Files/Mozilla Firefox/firefox.exe' : 'firefox');
    browser = spawn(executable,
      ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0'], { windowsHide: true });
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Firefox BiDi startup timed out.')), 15000);
      const read = chunk => { const match = chunk.toString().match(/WebDriver BiDi listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } };
      browser.stderr.on('data', read); browser.stdout.on('data', read);
      browser.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    socket = new WebSocket(endpoint.replace(/\/$/, '') + '/session');
    await once(socket, 'open');
    const pending = new Map(); let id = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timeout);
      if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`));
      else request.resolve(message.result);
    });
    command = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 20000);
      pending.set(requestId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const session = await command('session.new', { capabilities: {} });
    console.log('Firefox:', session.capabilities.browserVersion);
    await command('webExtension.install', { extensionData: { type: 'path', path: path.join(ROOT, 'dist/extension') } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.setViewport', { context, viewport: {width:1920,height:1080} });
    const navigate = url => command('browsingContext.navigate', { context, url, wait: 'complete' });
    const evaluate = async (expression, targetContext = context) => {
      const result = await command('script.evaluate', { expression: `Promise.resolve(${expression}).then(value => JSON.stringify(value))`, target: { context: targetContext }, awaitPromise: true });
      if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
      return result.result.value == null ? null : JSON.parse(result.result.value);
    };
    const wait = async expression => {
      const deadline = Date.now() + 30000;
      do { if (await evaluate(expression)) return; await pause(150); } while (Date.now() < deadline);
      throw new Error(`Timed out: ${expression}\n${await evaluate('localStorage.getItem("pokevin-scripts")')}\n${await evaluate('document.body.innerText')}`);
    };
    const origin = `http://127.0.0.1:${server.address().port}`;
    await navigate(origin + '/seed');
    await evaluate(`(() => {const state=${JSON.stringify(save)};state.lastTick=Date.now();localStorage.setItem('gachamon-save-v1',JSON.stringify(state));localStorage.setItem('pokecatch.lang','fr');localStorage.setItem('pokecatch-guide-seen',JSON.stringify(['adv','catch','team','league']));return true;})()`);
    await evaluate("localStorage.setItem('pokevin-scripts', JSON.stringify({scripts:[{id:'firefox-personal',name:'Script 1',code:''}],selectedId:'firefox-personal'}))");
    await navigate(origin + '/');
    await wait("!!document.querySelector('#timeline .tl-node, .title-fx .ti-go')");
    await evaluate("document.querySelector('.title-fx .ti-go')?.click()");
    await wait("!document.querySelector('.title-fx')");
    assert.equal(await evaluate("typeof window.pokevin?.changeChapter"), 'function');
    const sdk = await evaluate(`(async () => {
      const save = pokevin.saves.read();
      const catalog = await pokevin.battles.catalog(save);
      const battle = await pokevin.battles.prepare(save, 0);
      const a = await battle.fight(42), b = await battle.fight(42);
      battle.close();
      let closed = false;
      try { await battle.fight(); } catch { closed = true; }
      return { same: JSON.stringify(a) === JSON.stringify(b), closed, count: catalog.champions.length };
    })()`);
    assert.equal(sdk.same, true); assert.equal(sdk.closed, true); assert.ok(sdk.count > 0);
    await evaluate("pokevin.changeChapter(0).then(() => true)");
    await evaluate("document.querySelector('#pokevin-scripts').click()");
    await wait("!!document.querySelector('#screen-pokevin-scripts.active')");
    let editorContext;
    for (let i = 0; i < 100 && !editorContext; i++) {
      const tree = await command('browsingContext.getTree', { root: context });
      editorContext = tree.contexts[0].children?.find(child => child.url.includes('script-editor.html'))?.context;
      if (!editorContext) await pause(100);
    }
    assert.ok(editorContext, 'Editor frame loaded');
    const editorEvaluate = expression => evaluate(expression, editorContext);
    const editorWait = async expression => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) { if (await editorEvaluate(expression)) return; await pause(150); }
      throw new Error('Editor timeout: ' + expression);
    };
    await editorWait("!document.querySelector('#new-script').disabled");
    assert.equal(await editorEvaluate("document.querySelectorAll('.script-row').length"),2);
    assert.equal(await editorEvaluate("document.querySelectorAll('#builtin-scripts .script-row').length"),1);
    assert.equal(await editorEvaluate("document.querySelectorAll('#custom-scripts .script-row').length"),1);
    await editorEvaluate("document.querySelector('#builtin-heading button').focus()");
    await editorWait("getComputedStyle(document.querySelector('#builtin-tooltip')).visibility === 'visible'");
    assert.match(await editorEvaluate("document.querySelector('#builtin-tooltip').textContent"), /non modifiables et non supprimables/);
    await editorEvaluate("document.querySelector('#custom-heading button').focus()");
    await editorWait("getComputedStyle(document.querySelector('#builtin-tooltip')).visibility === 'hidden' && getComputedStyle(document.querySelector('#custom-tooltip')).visibility === 'visible'");
    assert.match(await editorEvaluate("document.querySelector('#custom-tooltip').textContent"), /modifiables et supprimables/);
    const bundledScript=await evaluate("JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.find(script=>script.id==='example-victory-chance')");
    await editorEvaluate("[...document.querySelectorAll('.script-select')].find(button=>button.textContent==='Calculateur de victoire').click()");
    await editorWait("document.querySelector('#script-name').readOnly");
    assert.equal(await editorEvaluate("document.querySelectorAll('.delete-script').length"),1);
    await editorEvaluate("document.querySelector('#custom-scripts .script-select').click()");
    await editorWait("!document.querySelector('#script-name').readOnly");
    await editorEvaluate("document.querySelector('#vim').click()");
    assert.equal(await editorEvaluate("document.querySelector('#vim').getAttribute('aria-pressed')"), 'true');
    await command('input.performActions', {context, actions:[{type:'key', id:'vim-insert', actions:
      ['i', ' ', '\uE00C'].flatMap(value => [{type:'keyDown',value},{type:'keyUp',value}]),
    }]});
    await command('input.releaseActions', {context});
    await wait("JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code === ' '");
    await editorWait("document.querySelector('#vim-status').textContent.includes('NORMAL')");
    await command('input.performActions', {context, actions:[{type:'key', id:'vim-undo', actions:[{type:'keyDown',value:'u'},{type:'keyUp',value:'u'}]}]});
    await command('input.releaseActions', {context});
    await wait("JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0].code === ''");
    await editorEvaluate("document.querySelector('#vim').click()");
    assert.equal(await editorEvaluate("document.querySelector('#vim').getAttribute('aria-pressed')"), 'false');
    await editorEvaluate("document.querySelector('#run').click()");
    await editorWait("document.querySelector('#status').textContent === 'Script exécuté.'");
    await editorEvaluate("document.querySelector('#run').click()");
    await editorWait("document.querySelector('#status').textContent === 'Callbacks arrêtés.'");
    await editorEvaluate("document.querySelector('.monaco-editor textarea').focus()");
    await command('input.performActions', { context, actions: [{ type:'key', id:'editor-keys', actions:[
      {type:'keyDown',value:'\uE03D'}, {type:'keyDown',value:'a'}, {type:'keyUp',value:'a'}, {type:'keyUp',value:'\uE03D'},
      ...[...'pokevin.'].flatMap(value=>[{type:'keyDown',value},{type:'keyUp',value}]),
      {type:'keyDown',value:'\uE009'}, {type:'keyDown',value:' '}, {type:'keyUp',value:' '}, {type:'keyUp',value:'\uE009'},
    ] }] });
    await command('input.releaseActions', { context });
    await editorWait("!!document.querySelector('.suggest-widget.visible') && document.querySelector('.suggest-widget.visible').textContent.includes('changeChapter')");
    const setEditorCode = async code => {
      await editorEvaluate("document.querySelector('.monaco-editor textarea').focus()");
      await command('input.performActions', {context, actions:[{type:'key',id:'replace-code',actions:[
        {type:'keyDown',value:'\uE03D'},{type:'keyDown',value:'a'},{type:'keyUp',value:'a'},{type:'keyUp',value:'\uE03D'},
      ]}]});
      await command('input.releaseActions', {context});
      await command('input.performActions', {context, actions:[{type:'key',id:'script-code',actions:
        [...code].flatMap(character => {
          const value = character === '\n' ? '\uE007' : character;
          return [{type:'keyDown',value},{type:'keyUp',value}];
        }),
      }]});
      await command('input.releaseActions', {context});
      await wait(`(() => {const library = JSON.parse(localStorage.getItem('pokevin-scripts')); return library.scripts.find(script => script.id === library.selectedId)?.code.replace(/\\s+/g, '') === ${JSON.stringify(code.replace(/\s+/g, ''))};})()`);
    };
    await editorEvaluate("(() => {const input = document.querySelector('#script-name'); input.value='Roamings Firefox';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await editorEvaluate("document.querySelector('#new-script').click()");
    await editorWait("document.querySelector('#script-name').value === 'Script 3'");
    await setEditorCode('const chapter = 14;');
    await editorEvaluate("document.querySelector('#custom-scripts .script-select').click()");
    await editorWait("document.querySelector('#script-name').value === 'Roamings Firefox'");
    await setEditorCode('pokevin.events.onBattleFinished(({ chapterId, roamer }) => { if (roamer) pokevin.changeChapter(chapterId); });');
    await editorWait(`(() => {
      const tokens = [...document.querySelectorAll('.view-lines span[class*="mtk"]')];
      const color = text => { const token = tokens.find(t => t.textContent === text); return token && getComputedStyle(token).color; };
      return color('onBattleFinished') === 'rgb(220, 220, 170)' && color('changeChapter') === color('onBattleFinished')
        && color('pokevin') === 'rgb(156, 220, 254)' && color('chapterId') === 'rgb(215, 186, 125)';
    })()`);
    await setEditorCode('pokevin.changeChapter(); const chapter = 14; // Chapitre');
    await editorWait("!!document.querySelector('.squiggly-error')");
    await editorWait(`(() => {
      const tokens = [...document.querySelectorAll('.view-lines span[class*="mtk"]')];
      const keyword = tokens.find(t => t.textContent.startsWith('const'));
      const comment = tokens.find(t => t.textContent.startsWith('//'));
      return keyword && comment && getComputedStyle(keyword).color !== getComputedStyle(comment).color;
    })()`);
    await setEditorCode('pokevin.changeChapter(14);');
    await editorWait("!document.querySelector('.squiggly-error')");
    await setEditorCode('globalThis.firefoxVersion = 1;');
    await editorEvaluate("document.querySelector('#run').click()");
    await wait("globalThis.firefoxVersion === 1");
    await setEditorCode('globalThis.firefoxVersion = 2;');
    await editorWait("!document.querySelector('#restart').hidden");
    await evaluate("document.querySelector('#tabs [data-screen=map]').click()");
    await editorWait("document.querySelector('#changes-dialog').open");
    await editorEvaluate("document.querySelector('#changes-dialog').close('cancel')");
    assert.equal(await evaluate("!!document.querySelector('#screen-pokevin-scripts.active')"),true);
    await editorEvaluate("document.querySelector('#restart').click()");
    await wait("globalThis.firefoxVersion === 2");
    await editorWait("document.querySelector('#restart').hidden");
    await editorEvaluate("document.querySelector('#run').click()");
    await editorWait("document.querySelector('#run').dataset.icon === 'play'");
    await editorEvaluate("document.querySelectorAll('.delete-script')[1].click()");
    await editorWait("document.querySelector('#delete-dialog').open");
    await editorEvaluate("document.querySelector('#delete-dialog button[value=cancel]').click()");
    assert.equal(await editorEvaluate("document.querySelectorAll('.script-row').length"), 3);
    await editorEvaluate("document.querySelectorAll('.delete-script')[1].click()");
    await editorEvaluate("document.querySelector('#delete-dialog button[value=delete]').click()");
    await editorWait("document.querySelectorAll('.script-row').length === 2");
    console.log('Firefox: restart indicator, navigation warning, highlighting, autocomplete and diagnostics passed.');
    // Restore the fixture's bundled script after testing library deletion and editing.
    await evaluate(`(() => {const library=JSON.parse(localStorage.getItem('pokevin-scripts'));const bundled=${JSON.stringify(bundledScript)};library.exampleCode='// Previous bundled source\\n'+bundled.code;library.scripts=library.scripts.map(script=>script.id===bundled.id?{...bundled,code:library.exampleCode}:script);localStorage.setItem('pokevin-scripts',JSON.stringify(library));})()`);
    await navigate(origin + '/');
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.find(script=>script.id==='example-victory-chance').code"),bundledScript.code);
    await wait("!!document.querySelector('.ti-go')");
    await evaluate("document.querySelector('.ti-go').click()");
    await wait("!document.querySelector('.title-fx')");
    await evaluate("(() => {const button = document.querySelector('#tabs [data-screen=adventure]');button.click();button.focus();})()");
    await wait("!document.querySelector('#screen-pokevin-scripts.active')");
    // The initial ordinary chapter must never show a roaming marker.
    assert.equal(await evaluate("document.querySelectorAll('#timeline .pc-timeline-roamer').length"), 0);
    await evaluate("document.querySelector('#tabs [data-screen=map]').click()");
    await evaluate("document.querySelector('#map-root [data-ch=\"0\"]').click()");
    await wait("['good','poor','result'].includes(document.querySelector('#pc-arena-chance')?.dataset.state)");
    await evaluate("globalThis.testBadge = pokevin.ui.chapterBadge(0, { id:'firefox-script-badge', text:'Mon XP/h', color:'#8b5cf6', tooltip:'Badge du script' })");
    assert.equal(await evaluate("document.querySelector('#firefox-script-badge').textContent"), 'Mon XP/h');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#firefox-script-badge b')).color"), 'rgb(139, 92, 246)');
    await evaluate("testBadge.update({text:'Mon résultat',color:'#42c978'})");
    assert.equal(await evaluate("document.querySelector('#firefox-script-badge').textContent"), 'Mon résultat');
    await evaluate("document.querySelector('#firefox-script-badge').focus()");
    await wait("[...document.querySelectorAll('[role=tooltip]')].some(node=>node.textContent==='Badge du script')");
    const badgeScreenshot = await command('browsingContext.captureScreenshot', { context, origin:'viewport' });
    const badgePNG = Buffer.from(badgeScreenshot.data, 'base64');
    assert.equal(badgePNG.readUInt32BE(16),1920); assert.equal(badgePNG.readUInt32BE(20),1080);
    fs.writeFileSync(path.join(ROOT,'artifacts/chapter-badges-firefox.png'),badgePNG);
    await evaluate("testBadge.remove()");
    assert.equal(await evaluate("document.querySelectorAll('#firefox-script-badge').length"),0);
    await evaluate(`(() => {globalThis.visitRecords=[];globalThis.offVisit=pokevin.chapters.onViewed(async (view,scope)=>{
      if(!view)return;
      const visit={scope,badge:scope.ui.chapterBadge(view.chapterId,{id:'firefox-visit',text:'Pending'})};
      visitRecords.push(visit);
      visit.battle=await scope.battles.prepare(pokevin.saves.read(),view.chapterId);
      await new Promise(resolve=>{visit.finish=resolve});
      visit.badge.update({text:'Finished'});
    });})()`);
    await wait("!!visitRecords[0]?.finish");
    await evaluate("document.querySelector('#pokevin-scripts').click()");
    await wait("!document.querySelector('#firefox-visit')");
    const visitErrors=await evaluate(`(async()=>{const errors=[];try{await visitRecords[0].battle.fight()}catch(error){errors.push(error.message)}try{await visitRecords[0].scope.battles.prepare(pokevin.saves.read(),0)}catch(error){errors.push(error.message)}return errors})()`);
    assert.match(visitErrors[0],/fermée/); assert.match(visitErrors[1],/arrêté/);
    await evaluate("(() => {document.querySelector('#tabs [data-screen=map]').click();document.querySelector('#map-root [data-ch=\"0\"]').click();})()");
    await wait("!!visitRecords[1]?.finish");
    await evaluate("visitRecords[0].finish()");
    assert.equal(await evaluate("document.querySelector('#firefox-visit').textContent"),'Pending');
    await evaluate("visitRecords[1].finish()");
    await wait("document.querySelector('#firefox-visit')?.textContent==='Finished'");
    await evaluate("offVisit()");
    assert.equal(await evaluate("document.querySelectorAll('#firefox-visit').length"),0);
    assert.ok(await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).mons.every(mon => !('nature' in mon))"));
    assert.equal(await evaluate("document.querySelectorAll('.pc-advisor-warning').length"), 0);
    const before = await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).team");
    await evaluate("document.querySelector('#pc-team-advisor button').click()");
    await wait("document.querySelector('#pc-team-advisor')?.dataset.status === 'result'");
    const proposed = await evaluate("[...document.querySelectorAll('.pc-advisor-team li')].map(item=>item.dataset.uid)");
    assert.ok(proposed.includes('firefox-6'));
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).team"), before);
    assert.doesNotMatch(await evaluate("document.querySelector('#pc-team-advisor').innerText"), /Face à|Équipe actuelle|Ta collection/);
    await evaluate("document.querySelector('.pc-advisor-result button').click()");
    await wait("document.querySelector('.pc-advisor-result button')?.textContent === 'Équipe appliquée'");
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).team"), proposed);
    await evaluate("document.querySelector('#tabs [data-screen=team]').click()");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#team-slots > .slot.filled')].map(item=>item.dataset.uid)"), proposed);
    await wait("document.querySelectorAll('#pc-grid .pc-cell:not(.ug-out)').length >= 3");
    await wait("document.querySelector('#screen-team.active') && getComputedStyle(document.querySelector('#screen-team')).opacity === '1'");
    const pc = await evaluate("[...document.querySelectorAll('#pc-grid .pc-cell:not(.ug-out)')].slice(0,3).map(el=>({uid:el.dataset.uid,x:Math.round(el.getBoundingClientRect().left+el.clientWidth/2),y:Math.round(el.getBoundingClientRect().top+el.clientHeight/2)}))");
    assert.equal(pc.length, 3);
    await command('browsingContext.activate', {context});
    const click = async (point, control = false) => {
      await command('input.performActions', { context, actions: [
        { type: 'key', id: 'keys', actions: [{type:'keyDown',value:control?'\uE03D':'\uE000'}] },
        { type: 'pointer', id: 'mouse', parameters: {pointerType:'mouse'}, actions: [
          {type:'pointerMove',x:point.x,y:point.y,duration:0}, {type:'pointerDown',button:0}, {type:'pointerUp',button:0}] },
      ] });
      await command('input.releaseActions', {context});
    };
    // Cmd-drag toggles crossed cards once, even when the pointer crosses them again.
    await command('input.performActions', {context, actions:[
      {type:'key',id:'keys',actions:[{type:'keyDown',value:'\uE03D'}]},
      {type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[
        {type:'pointerMove',x:pc[0].x,y:pc[0].y,duration:0},{type:'pointerDown',button:0},
        {type:'pointerMove',x:pc[2].x,y:pc[2].y,duration:100},
        {type:'pointerMove',x:pc[0].x,y:pc[0].y,duration:100},{type:'pointerUp',button:0}]}]});
    await command('input.releaseActions',{context});
    assert.equal(await evaluate("document.querySelectorAll('.pc-multi-selected').length"),3);
    assert.equal(await evaluate("document.querySelectorAll('#modal-root.open').length"),0);
    await evaluate("document.querySelector('.pc-multi-bar button').click()");
    await click(pc[0], true); await click(pc[1], true);
    assert.equal(await evaluate("document.querySelectorAll('.pc-multi-selected').length"), 2);
    const pcBefore = await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).mons.map(mon=>mon.uid).sort()");
    await command('input.performActions', {context, actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',x:pc[0].x,y:pc[0].y,duration:0},{type:'pointerDown',button:0},
      {type:'pointerMove',x:pc[2].x+20,y:pc[2].y,duration:300},{type:'pointerUp',button:0}]}]});
    await command('input.releaseActions', {context});
    await wait("!document.body.classList.contains('pc-multi-busy') && JSON.parse(localStorage.getItem('gachamon-save-v1')).pcSort === 'custom'");
    const pcOrder = await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).pcOrder");
    assert.deepEqual(pcOrder.slice(pcOrder.indexOf(pc[2].uid)+1,pcOrder.indexOf(pc[2].uid)+3),[pc[0].uid,pc[1].uid]);
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('gachamon-save-v1')).mons.map(mon=>mon.uid).sort()"), pcBefore);
    const roamingSave = structuredClone(save);
    Object.assign(roamingSave.adv, { chapter: 14, unlocked: 25, badges: ['Maître Johto'], gifts: { starter: 1, 'starter-johto': 152 } });
    roamingSave.travel = { to: ['johto'] };
    roamingSave.roam = { at: { 243: { ch: 14, until: Date.now() + 600000 } }, caught: [244, 245, 380, 381, 481] };
    await navigate(origin + '/seed');
    await evaluate(`(() => {const state=${JSON.stringify(roamingSave)};state.lastTick=Date.now();localStorage.setItem('gachamon-save-v1',JSON.stringify(state));return true;})()`);
    await navigate(origin + '/');
    await wait("!!document.querySelector('.ti-go')");
    await evaluate("document.querySelector('.ti-go').click()");
    await wait("!document.querySelector('.title-fx')");
    await evaluate("document.querySelector('#tabs [data-screen=map]').click()");
    await evaluate("document.querySelector('#map-root [data-ch=\"14\"]').click()");
    await wait("document.querySelector('#pc-arena-chance')?.dataset.champion === 'Raikou'");
    await wait("document.querySelector('#timeline .pc-timeline-roamer')?.getAttribute('alt') === 'Raikou'");
    assert.equal(await evaluate("document.querySelector('#timeline .pc-timeline-roamer').getAttribute('title')"), '');
    assert.equal(await evaluate("(() => {const state=JSON.parse(localStorage.getItem('gachamon-save-v1'));const index=state.adv.nodes.findIndex(node=>node.roamer===243);return document.querySelectorAll('#timeline .tl-node')[index]?.querySelector('.pc-timeline-roamer')?.getAttribute('data-id');})()"), '243');
    await evaluate("document.querySelector('#tabs [data-screen=adventure]').click()");
    await wait("document.querySelector('#timeline .pc-timeline-roamer')?.getAttribute('alt') === 'Raikou'");
    await wait("getComputedStyle(document.querySelector('#screen-adventure')).opacity === '1' && !document.querySelector('#screen-map.active')");
    await evaluate("document.querySelector('#timeline .pc-timeline-roamer').decode().then(()=>true)");
    const screenshot = await command('browsingContext.captureScreenshot', { context, origin: 'viewport' });
    const png = Buffer.from(screenshot.data, 'base64');
    assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'artifacts/roaming-timeline-firefox.png'), png);
    await evaluate("document.querySelector('#tabs [data-screen=map]').click()");
    await evaluate("document.querySelector('#map-root [data-ch=\"15\"]').click()");
    await wait("document.querySelector('.ch-det:not(.det-out) #pc-arena-chance')?.dataset.champion === 'Hector'");
    await evaluate("document.querySelector('#pc-chapter-preview summary').click()");
    assert.equal(await evaluate("document.querySelectorAll('#pc-chapter-preview .pc-preview-trainer').length"), 1);
    await evaluate("document.querySelector('#pc-chapter-preview .pc-preview-trainer').focus()");
    await wait("document.querySelector('.pc-trainer-tooltip:not([hidden])')?.innerText.includes('Hector')");
    await evaluate("document.querySelector('#map-root [data-ch=\"L\"]').click()");
    await wait("document.querySelectorAll('.lg-mem > pc-ui-root').length === 5");
    assert.equal(await evaluate("document.querySelector('.lg-who b').textContent"), '???');
    const rowPoint = await evaluate("(() => {const r=document.querySelector('.lg-mem').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
    await command('input.performActions', {context, actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',x:rowPoint.x,y:rowPoint.y,duration:100}]}]});
    await wait("document.querySelector('.pc-trainer-tooltip:not([hidden])')?.innerText.includes('Clément')");
    assert.equal(await evaluate("document.querySelectorAll('.pc-trainer-tooltip:not([hidden]) .pc-preview-team > li').length"), 6);
    await evaluate("document.querySelector('.lg-mem').focus()");
    await wait("document.querySelector('.pc-trainer-tooltip:not([hidden])')?.innerText.includes('Clément')");
    await evaluate("document.querySelector('.lg-mem').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
    await wait("!document.querySelector('.pc-trainer-tooltip:not([hidden])')");
    await wait("document.querySelector('#pc-arena-chance')?.dataset.champion === 'Ligue entière'");
    assert.match(await evaluate("document.querySelector('#pc-arena-chance').textContent"),/Victoire .*%/);
    await evaluate("document.querySelector('#pc-arena-chance').focus()");
    await wait("[...document.querySelectorAll('[role=tooltip]')].some(node=>node.textContent.includes('Contre Ligue entière'))");
    const leagueScreenshot=await command('browsingContext.captureScreenshot',{context,origin:'viewport'});
    const leaguePNG=Buffer.from(leagueScreenshot.data,'base64');
    assert.equal(leaguePNG.readUInt32BE(16),1920);assert.equal(leaguePNG.readUInt32BE(20),1080);
    fs.writeFileSync(path.join(ROOT,'artifacts/league-victory-firefox.png'),leaguePNG);
    console.log('Firefox passed: extension, optimizer, native apply, PC selection/drag, roaming chance, champion cards, undiscovered League team hover and keyboard.');
  } finally {
    if (command && socket?.readyState === WebSocket.OPEN) await command('browser.close').catch(() => {});
    socket?.close();
    if (browser && browser.exitCode == null) {
      await Promise.race([once(browser, 'exit'), pause(3000)]);
      if (browser.exitCode == null) { browser.kill(); await once(browser, 'exit'); }
    }
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
