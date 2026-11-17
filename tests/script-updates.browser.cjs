// Exercise real WXT reloads against an isolated copy of the extension sources.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function main() {
  const directory = fs.mkdtempSync(path.join(ROOT, 'artifacts/script-updates-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-dev-update-'));
  const gamePort = await freePort(), devPort = await freePort();
  const gameUrl = `http://127.0.0.1:${gamePort}/`;
  const plugin = path.join(directory, 'plugin');
  fs.cpSync(path.join(ROOT, 'plugin'), plugin, { recursive: true });
  fs.cpSync(path.join(ROOT, 'engine'), path.join(directory, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'wxt.config.mjs'), `import base from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'wxt.config.mjs')).href)};\nexport default {...base,webExt:{disabled:true}};\n`);
  const dev = spawn(process.execPath, [path.join(ROOT, 'node_modules/wxt/bin/wxt.mjs'), directory, '--port', String(devPort)], {
    cwd: ROOT, env: {...process.env, PORT:String(gamePort), GAME_DIR:path.resolve(process.env.GAME_DIR || path.join(ROOT,'artifacts/game'))},
  });
  let logs = '', context;
  dev.stdout.on('data', data => { logs += data; });
  dev.stderr.on('data', data => { logs += data; });
  try {
    const manifest = path.join(directory, 'dist/extension-dev/manifest.json');
    const deadline = Date.now() + 90000;
    while (!fs.existsSync(manifest)) {
      if (dev.exitCode !== null || Date.now() > deadline) throw new Error('WXT startup failed:\n' + logs);
      await pause(200);
    }
    context = await chromium.launchPersistentContext(profile, { channel:'chromium', headless:true,
      viewport:{width:1920,height:1080}, args:[`--disable-extensions-except=${path.dirname(manifest)}`,`--load-extension=${path.dirname(manifest)}`] });
    await context.route('**/*supabase.co/**', route => route.abort());
    const page = await context.newPage();
    const source = fs.readFileSync(process.env.GAME_SAVE_BUNDLE || path.join(ROOT,'artifacts/game/bundle',require('../engine/version.json').bundle),'utf8');
    const start = source.indexOf('.SaveWire=function()'), end = source.indexOf('(),function()',start);
    assert.ok(start >= 0 && end > start);
    const wire = vm.runInNewContext('('+source.slice(start+'.SaveWire='.length,end+2)+')');
    const {Game} = PokeCatchEngine, save = Game.freshState();
    save.trainer = {name:'Dev update test',sprite:'red',feats:{}};
    save.mons = [1,4,7].map((id,i)=>({...Game.makeMon(id,15,{shiny:false}),uid:`dev-update-${i}`}));
    save.team = save.mons.map(mon=>mon.uid);
    save.adv = {chapter:0,unlocked:0,nodes:[],node:0,layout:6,badges:[],gifts:{starter:true},kept:{},speed:1,paused:true,loops:[],runs:0};
    await page.goto(new URL('/seed.html',gameUrl).href);
    await page.evaluate(state=>{
      state.lastTick=Date.now();localStorage.setItem('gachamon-save-v1',JSON.stringify(state));
      localStorage.setItem('pokecatch.lang','fr');
      localStorage.setItem('pokecatch-guide-seen',JSON.stringify(['adv','catch','team','league']));
    },wire.pack(save));
    await page.goto(gameUrl);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pokevin-scripts'))?.scripts.length === 4);
    await page.evaluate(() => {
      const library=JSON.parse(localStorage.getItem('pokevin-scripts'));
      const script=library.scripts.find(script=>script.id==='example-victory-chance');
      script.name='Mon indicateur';
      script.code=script.code.replace('⚔️ Victoire','Mon indicateur')+'\n// Personal edit before source update\n';
      localStorage.setItem('pokevin-scripts',JSON.stringify(library));
    });
    const personal = await page.evaluate(()=>JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0]);
    const before = await page.evaluate(()=>performance.timeOrigin);
    const badgeFile = path.join(plugin,'scripts/victory-badge.js');
    const changed = fs.readFileSync(badgeFile,'utf8').replace('text: `⚔️ Victoire ${percent} %`','text: `Dev actualisé ${percent} %`');
    fs.writeFileSync(badgeFile,changed);
    await page.waitForFunction(before=>performance.timeOrigin!==before,before,{timeout:60000});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pokevin-scripts'))?.scripts.length === 4);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pokevin-scripts')).scripts[0]),personal);
    await page.locator('.title-fx .ti-go').click();
    await page.locator('.title-fx').waitFor({state:'detached'});
    await page.locator('#tabs [data-screen="map"]').click();
    await page.locator('#map-root [data-ch="0"]').click();
    await page.waitForFunction(()=>document.querySelector('#pc-arena-chance')?.textContent.startsWith('Mon indicateur'));
    await page.evaluate(()=>{
      pokevin.stop();
      const library=JSON.parse(localStorage.getItem('pokevin-scripts'));
      library.scripts=library.scripts.filter(script=>script.id!=='example-victory-chance');
      library.selectedId=library.scripts[0].id;
      localStorage.setItem('pokevin-scripts',JSON.stringify(library));
    });
    const nextReload=await page.evaluate(()=>performance.timeOrigin);
    fs.writeFileSync(badgeFile,changed.replace('Dev actualisé','Dev deuxième version'));
    await page.waitForFunction(before=>performance.timeOrigin!==before,nextReload,{timeout:60000});
    await page.waitForFunction(()=>!!window.pokevin);
    const remaining=await page.evaluate(()=>JSON.parse(localStorage.getItem('pokevin-scripts')));
    assert.equal(remaining.scripts.length,3);
    assert.ok(remaining.scripts.every(script=>script.autoStart===false));
    assert.ok(!remaining.scripts.some(script=>script.id==='example-victory-chance'));
    console.log('WXT dev: source reload preserves edited names/code, stopped scripts and deletion; no automatic source replacement.');
  } catch(error) { console.error(logs.slice(-7000)); throw error; }
  finally {
    await context?.close();
    dev.kill('SIGTERM');
    await new Promise(resolve=>{if(dev.exitCode!==null)resolve();else dev.once('exit',resolve);});
    fs.rmSync(profile,{recursive:true,force:true});
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
