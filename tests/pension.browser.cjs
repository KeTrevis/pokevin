// Real local frontend, temporary profile and installed extension.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('../engine/core.js');
const ROOT = path.resolve(__dirname, '..');
async function main() {
  const {Game} = PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = {name: 'Pension test', sprite: 'red', feats: {}};
  save.mons = [4, 7, 25].map((id, i) => ({...Game.makeMon(id, 15, {shiny: false}), uid: `team-${i}`}));
  save.team = save.mons.map(mon => mon.uid);
  save.adv = {chapter: 0, unlocked: 0, badges: [], gifts: {starter: 1}, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, paused: true, runs: 0};
  save.pension = {mons: [132, 1].map((id, i) => ({
    mon: {...Game.makeMon(id, 15, {shiny: false}), uid: `pension-${i}`}, candy: 0,
  })), eggs: [], egg: 2 * 3600000, tick: Date.now()};
  save.items['berry-oran'] = 2;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-pension-'));
  const context = await chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true,
    viewport: {width: 1920, height: 1080}, args: [`--disable-extensions-except=${path.join(ROOT,'dist/extension')}`, `--load-extension=${path.join(ROOT,'dist/extension')}`]});
  try {
    await context.route('**/*supabase.co/**', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror',error=>console.error('Page error:',error.message));
    const origin = process.env.GAME_URL || 'http://127.0.0.1:8080/';
    await page.goto(new URL('seed.html',origin).href);
    await page.evaluate(state => {
      state.lastTick = Date.now(); state.pension.tick = Date.now();
      localStorage.setItem('gachamon-save-v1',JSON.stringify(state));
      localStorage.setItem('pokecatch.lang','fr');
      localStorage.setItem('pokecatch-guide-seen',JSON.stringify(['adv','catch','team','league','pen']));
    },save);
    const open = async () => {
      await page.goto(origin);
      await page.locator('.ti-go').click();
      await page.locator('.title-fx').waitFor({state:'detached'});
      await page.locator('#tabs [data-screen=pension]').evaluate(button=>button.click());
    };
    const countdown = '#pen-res .pen-row[data-pc-egg-next]';
    const check = async () => {
      await page.waitForFunction(selector => {
        const row=document.querySelector(selector);
        return row && row.dataset.pcEggNext === row.title.split(' · ').pop();
      },countdown);
      assert.equal(await page.locator(countdown).count(),1);
    };
    await open(); await check();
    console.log('Pension built-in visible.');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.find(script=>script.id==='builtin-pension-countdown').autoStart),true);
    const before = await page.locator(countdown).getAttribute('data-pc-egg-next');
    await page.locator('#pen-berries [data-berry="berry-oran"]').evaluate(button => button.click());
    await page.waitForFunction(previous => document.querySelector('#pen-res [data-pc-egg-next]')?.getAttribute('data-pc-egg-next') !== previous,before);
    await check();
    console.log('Native berry countdown updated.');
    await page.evaluate(async () => {await Promise.all([...document.images].filter(image=>{const r=image.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0}).map(image=>image.decode().catch(()=>{})))});
    const screenshot = path.join(ROOT,'artifacts/pension-script-chromium.png');
    await page.screenshot({path:screenshot});
    const png=fs.readFileSync(screenshot); assert.equal(png.readUInt32BE(16),1920); assert.equal(png.readUInt32BE(20),1080);
    await page.setViewportSize({width:390,height:844}); await check();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:1920,height:1080});
    const editor = page.frameLocator('#screen-pokevin-scripts iframe');
    const select = async () => {
      await page.locator('#pokevin-scripts').click();
      await editor.locator('.script-select').filter({hasText:'Compte à rebours des œufs'}).click();
    };
    await select();
    await editor.locator('#run[data-icon=stop]').click();
    await page.waitForFunction(()=>!document.querySelector('#pen-res [data-pc-egg-next]'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pokevin-scripts')).scripts.find(script=>script.id==='builtin-pension-countdown').autoStart),false);
    await open();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator(countdown).count(),0,'stopped choice survives reload');
    await select(); await editor.locator('#run[data-icon=play]').click();
    await page.locator('#tabs [data-screen=pension]').evaluate(button=>button.click()); await check();
    await page.locator('#tabs [data-screen=map]').click();
    await page.locator('#tabs [data-screen=pension]').evaluate(button=>button.click()); await check();
    await open(); await check();
    console.log('Chromium pension: native berry update, redraw, mobile, built-in stop/restart and reload persistence passed. Screenshot: '+screenshot);
  } finally {await context.close();fs.rmSync(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
