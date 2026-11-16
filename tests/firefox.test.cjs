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
  save.adv = { chapter: 0, unlocked: 0, badges: [], gifts: {}, kept: {}, layout: 6,
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
    await command('webExtension.install', { extensionData: { type: 'path', path: ROOT } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.setViewport', { context, viewport: {width:1920,height:1080} });
    const navigate = url => command('browsingContext.navigate', { context, url, wait: 'complete' });
    const evaluate = async expression => {
      const result = await command('script.evaluate', { expression: `JSON.stringify(${expression})`, target: { context }, awaitPromise: true });
      if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
      return result.result.value == null ? null : JSON.parse(result.result.value);
    };
    const wait = async expression => {
      const deadline = Date.now() + 30000;
      do { if (await evaluate(expression)) return; await pause(150); } while (Date.now() < deadline);
      throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`);
    };
    const origin = `http://127.0.0.1:${server.address().port}`;
    await navigate(origin + '/seed');
    await evaluate(`(() => {localStorage.setItem('gachamon-save-v1',${JSON.stringify(JSON.stringify(save))});localStorage.setItem('pokecatch.lang','fr');return true;})()`);
    await navigate(origin + '/');
    await wait("!!document.querySelector('.title-fx .ti-go')");
    await evaluate("document.querySelector('.title-fx .ti-go').click()");
    await wait("!document.querySelector('.title-fx')");
    await evaluate("document.querySelector('#tabs [data-screen=map]').click()");
    await evaluate("document.querySelector('#map-root [data-ch=\"0\"]').click()");
    await wait("['good','poor','result'].includes(document.querySelector('#pc-arena-chance')?.dataset.state)");
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
    await evaluate(`(() => {localStorage.setItem('gachamon-save-v1',${JSON.stringify(JSON.stringify(roamingSave))});return true;})()`);
    await navigate(origin + '/');
    await wait("!!document.querySelector('.ti-go')");
    await evaluate("document.querySelector('.ti-go').click()");
    await wait("!document.querySelector('.title-fx')");
    await evaluate("document.querySelector('#tabs [data-screen=map]').click()");
    await evaluate("document.querySelector('#map-root [data-ch=\"14\"]').click()");
    await wait("document.querySelector('#pc-arena-chance')?.dataset.champion === 'Raikou'");
    await evaluate("document.querySelector('#map-root [data-ch=\"15\"]').click()");
    await wait("document.querySelector('.ch-det:not(.det-out) #pc-arena-chance')?.dataset.champion === 'Hector'");
    console.log('Firefox passed: extension, optimizer, native apply, PC selection/drag, roaming chance and gym fallback.');
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
