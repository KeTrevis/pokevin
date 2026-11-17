const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../engine/core.js');
require('../plugin/simulator.js');
require('../plugin/encounter-simulator.js');
require('../plugin/sdk/adventures.js');
require('../plugin/sdk/battles.js');
require('../plugin/scripts/chapter-xp.js');
function fixture() {
 const {Game}=PokeCatchEngine,save=Game.freshState();
 save.mons=[1,4,7].map((id,i)=>({...Game.makeMon(id,10,{shiny:false}),uid:`route-${i}`}));
 save.team=save.mons.map(mon=>mon.uid);
 save.adv={chapter:0,unlocked:0,nodes:[],node:0,layout:6,badges:[],gifts:{starter:true},kept:{},speed:1};
 return save;
}
function port() {
 let receive,disconnect,sequence=0;
 const pending=new Map();
 PokevinBattleSDK.connect({onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener:fn=>{disconnect=fn;}},
  postMessage:reply=>{pending.get(reply.requestId)?.(reply);pending.delete(reply.requestId);}});
 return {disconnect,call(method,args={}){const requestId=++sequence;return new Promise(resolve=>{pending.set(requestId,resolve);receive({method,requestId,...args});});}};
}
test('adventure RPC returns raw native events and timing and leaves the compact-decoded snapshot unchanged',async()=>{
 global.chrome={runtime:{getPlatformInfo:callback=>callback({})}};
 const connection=port(),save=fixture(),before=JSON.stringify(save);
 try {
  const {value,error}=await connection.call('simulateAdventure',{save,target:0,options:{now:123456789}});
  assert.equal(error,undefined);
  assert.ok(value.events.some(event=>event.type==='xp'));
  assert.ok(value.events.some(event=>event.type==='battleStart'));
  assert.equal(value.elapsedMs,value.actions*PokeCatchEngine.CONFIG.ACTION_MS);
  assert.equal(value.teamIds.length,3);
  assert.equal('xpPerHour' in value,false);
  assert.equal(JSON.stringify(save),before);
  assert.match((await connection.call('simulateAdventure',{save,target:999})).error,/accessible/);
  assert.match((await connection.call('simulateAdventure',{save,target:0,options:{now:'bad'}})).error,/invalides/);
  assert.match((await connection.call('simulateAdventure',{save:null,target:0})).error,/Sauvegarde/);
 } finally {connection.disconnect();delete global.chrome;}
});
test('disconnecting a route stops native actions and releases the sandbox between batches',async()=>{
 global.chrome={runtime:{getPlatformInfo:callback=>callback({})}};
 const native=PokeCatchEngine.Adventure.step,connection=port();let actions=0;
 PokeCatchEngine.Adventure.step=()=>{actions++;if(actions===64)queueMicrotask(()=>connection.disconnect());return [];};
 try {
  void connection.call('simulateAdventure',{save:fixture(),target:0});
  await new Promise(resolve=>setTimeout(resolve,10));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(actions,64);
  assert.equal(PokeCatchEngine.Game.S,undefined);
 } finally {PokeCatchEngine.Adventure.step=native;connection.disconnect();delete global.chrome;}
});
test('XP policy belongs to the script and includes partial XP and defeat duration',async()=>{
 let calls=0;
 const simulate=async()=>{calls++;return {events:[{type:'xp',uid:'team',amount:5},{type:'xp',uid:'other',amount:100}],teamIds:['team'],elapsedMs:1000,outcome:calls%2?'completed':'defeat',speed:2,league:true,now:123};};
 const script=PokevinChapterXP(simulate,{},0,123);
 let step;do {step=await script.next();}while(!step.done);
 assert.equal(calls,20);
 assert.deepEqual(step.value,{xpPerHour:18000,xp:100,elapsedMs:20000,runs:20,completed:10,defeats:10,speed:2,league:true,now:123});
 const canceled=PokevinChapterXP(simulate,{},0,123);
 await canceled.next();await canceled.return();assert.equal(calls,21);
});
test('the exact installed XP source renders through the generic badge API',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const context={source:fs.readFileSync(require.resolve('../plugin/scripts/chapter-xp.js'),'utf8'),badgeSource:fs.readFileSync(require.resolve('../plugin/scripts/xp-badge.js'),'utf8'),roamingSource:fs.readFileSync(require.resolve('../plugin/scripts/roaming-timeline.js'),'utf8'),pensionSource:fs.readFileSync(require.resolve('../plugin/scripts/pension-countdown.js'),'utf8'),PokevinExampleScript:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../plugin/scripts/xp-example.js'),'utf8').replace(/^import .*;$/gm,''),context);
 let completion,calls=0,props;
 const scope={battles:{catalog:async()=>({bundle:'test.js'})},simulate:async()=>{calls++;return {events:[{type:'xp',uid:'team',amount:1}],teamIds:['team'],elapsedMs:1000,outcome:'defeat',speed:1,league:false};},ui:{chapterBadge:(id,initial)=>{
  assert.equal(id,0);props=initial;return {update:patch=>{props={...props,...patch};}};
 }}};
 new Function('pokevin',context.PokevinXPExampleScript.code)({saves:{read:()=>({})},chapters:{onViewed:callback=>{completion=callback({chapterId:0},scope);}}});
 await completion;
 assert.equal(calls,20);assert.equal(props.busy,false);
 assert.equal(props.text,'XP/h ≈ 3 600');
 assert.match(props.tooltip,/0\/20 parcours/);
 assert.equal(props.gameBundle,'test.js');
});
