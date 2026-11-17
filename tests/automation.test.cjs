const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(saved, example, defaults, realUI=false){
 class Storage {constructor(){this.values=new Map()}setItem(k,v){this.values.set(k,String(v))}getItem(k){return this.values.get(k)??null}}
 const pending=[], errors=[]; let subscriptions=0;
 const context={crypto:{randomUUID:require('node:crypto').randomUUID},PokevinExampleScript:{id:'example-victory-chance',name:'Calculateur',code:'pokevin.chapters.onViewed(() => {});'}, PokevinCreateUI:cleanups=>({ui:{},chapters:{onViewed:()=>{subscriptions++;const off=()=>{subscriptions--;cleanups.delete(off)};cleanups.add(off);return off}}}),addEventListener(){},Storage, localStorage:new Storage(), queueMicrotask:fn=>pending.push(fn), console:{error:(...args)=>errors.push(args)},
 document:{documentElement:{},scripts:[],addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]},MutationObserver:class{observe(){}disconnect(){}},VERSION_WARNING:"warning",setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout};
 if(example)context.PokevinExampleScript=example;
 if(saved)context.localStorage.setItem('pokevin-scripts',JSON.stringify(saved));
 context.PokevinDefaultScripts=defaults??[{...context.PokevinExampleScript,autoStart:true}];
 context.window=context;
 if(realUI)vm.runInNewContext(fs.readFileSync(require.resolve('../plugin/sdk/ui.js'),'utf8').replace(/^import .*;$/m,''),context);
 vm.runInNewContext(fs.readFileSync(require.resolve('../plugin/sdk/client.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(require.resolve('../plugin/automation.js'),'utf8'),context);
 const write=adv=>{context.localStorage.setItem('gachamon-save-v1',JSON.stringify({fmt:2,adv}));while(pending.length)pending.shift()()};
 return {api:context.pokevin,write,errors,context,subscriptions:()=>subscriptions,library:()=>JSON.parse(context.localStorage.getItem('pokevin-scripts'))};
}
const adv=(changes={})=>({chapter:14,runs:0,node:0,nodes:[{type:'wild',roamer:243},{type:'heal'}],...changes});
test('compact saves emit roaming battle completion once, after native save; unsubscribe and stop work',()=>{
 const {api,write}=setup(),seen=[];
 write(adv());
 const off=api.events.onBattleFinished(({chapterId,roamer})=>seen.push([chapterId,roamer]));
 write(adv({node:1}));write(adv({node:1}));
 assert.deepEqual(seen,[[14,243]]);
 off();write(adv());write(adv({node:1}));assert.equal(seen.length,1);
 api.events.onChapterStarted(({chapterId})=>seen.push(chapterId));api.stop();write(adv({chapter:15}));assert.equal(seen.length,1);
});
test('completion precedes start, includes the last battle, and manually leaving does not complete a chapter',()=>{
 const {api,write}=setup(),seen=[];
 for(const [event,label] of [['onChapterStarted','start'],['onChapterFinished','end'],['onBattleFinished','battle']])api.events[event](({chapterId})=>seen.push([label,chapterId]));
 write(adv());write(adv({chapter:15}));assert.deepEqual(seen,[['start',15]]);
 seen.length=0;write(adv({chapter:14,runs:1}));
 assert.deepEqual(seen,[['battle',15],['end',15],['start',14]]);
});
test('mode switches and initial load do not synthesize battle or completion events; callback failures are isolated',async()=>{
 const {api,write,errors}=setup(),seen=[];
 assert.throws(()=>api.events.onChapterStarted(null),/Callback/);
 api.events.onChapterStarted(()=>{throw new Error('broken')});
 api.events.onChapterStarted(({chapterId})=>seen.push(chapterId));
 write(adv());write(adv({zone:{id:1}}));write(adv());assert.equal(seen.length,0);
 write(adv({chapter:15}));assert.deepEqual(seen,[15]);assert.equal(errors.length,1);
 await assert.rejects(api.changeChapter('oops'),/invalide/);
 await assert.rejects(api.changeChapter(14),/indisponible/);
});

test('callbacks receive one independent event object containing chapterId',()=>{
 const {api,write}=setup(),seen=[];
 api.events.onBattleFinished(function(detail){assert.equal(arguments.length,1);detail.chapterId=999;detail.node=999;});
 api.events.onBattleFinished(function(detail){assert.equal(arguments.length,1);seen.push(detail);});
 api.events.onChapterStarted(function(detail){assert.equal(arguments.length,1);seen.push(detail);});
 api.events.onChapterFinished(function(detail){assert.equal(arguments.length,1);seen.push(detail);});
 write(adv());write(adv({node:1}));write(adv({node:1,runs:1}));
 assert.deepEqual(JSON.parse(JSON.stringify(seen)),[{chapterId:14,node:0,roamer:243},{chapterId:14},{chapterId:14}]);
});

test('default scripts are installed once and stopping persists for every script',()=>{
 const env=setup();assert.equal(env.subscriptions(),1);
 assert.equal(env.library().scripts.length,1);
 env.api.stop();assert.equal(env.subscriptions(),0);
 assert.equal(setup(env.library()).subscriptions(),0);
 assert.equal(setup({scripts:[],selectedId:''}).library().scripts.length,0);
});

test('migration preserves names, code, selection and execution preferences without making copies',()=>{
 const saved={scripts:[{id:'example-victory-chance',name:'Mon indicateur',code:'pokevin.chapters.onViewed(() => {}); // personal',autoStart:true,bundled:true},
  {id:'mine',name:'Perso',code:'// saved',autoStart:false}],selectedId:'mine',examplesVersion:4,exampleCode:'old source',bundledCodes:{'example-victory-chance':'old source'}};
 const env=setup(saved);
 assert.equal(env.subscriptions(),1);
 assert.deepEqual(env.library(),{scripts:saved.scripts.map(({bundled,...script})=>script),selectedId:'mine'});
 const changed={...env.context.PokevinExampleScript,code:'throw new Error("new default")'};
 assert.deepEqual(setup(env.library(),changed).library(),env.library());
});

test('running personal scripts restart too, and an empty library remains empty after updates',()=>{
 const env=setup({scripts:[{id:'mine',name:'Mine',code:'pokevin.chapters.onViewed(() => {});',autoStart:true}],selectedId:'mine'});
 assert.equal(env.subscriptions(),1);env.api.stop();
 assert.equal(env.library().scripts[0].autoStart,false);
 assert.equal(setup(env.library()).subscriptions(),0);
 assert.deepEqual(setup({scripts:[],selectedId:''}).library(),{scripts:[],selectedId:''});
});

test('default victory source remains readable and typed',()=>{
 const context={source:fs.readFileSync(require.resolve('../plugin/scripts/victory-chance.js'),'utf8'),badgeSource:fs.readFileSync(require.resolve('../plugin/scripts/victory-badge.js'),'utf8')};
 const builder=fs.readFileSync(require.resolve('../plugin/scripts/victory-chance-example.js'),'utf8').replace(/^import .*;$/gm,'');
 vm.runInNewContext(builder,context);
 const example=context.PokevinExampleScript;
 assert.doesNotMatch(example.code,/const previous = current|current !== job/);
 assert.match(example.code,/async function\* calculateVictoryChance\(battles, save, target\)/);
 assert.match(example.code,/const calculation = calculateVictoryChance\(battles, save, view.chapterId\)/);
 assert.match(example.code,/function getColor\(state\)/);
 assert.doesNotMatch(example.code,/globalThis\.PokevinVictoryChance|startVictoryBadge|const \w+ = (async )?function|\?/);
 assert.doesNotMatch(example.code,/\/\//);
 assert.match(example.code,/@param \{import\('\.\.\/types\/battles'\)\.Battles\} battles/);
 assert.doesNotMatch(example.code,/\n}\n(?:\/\*\*|(?:async )?function)/);
 const path=require('node:path');
 fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});
 const directory=fs.mkdtempSync(path.join(__dirname,'../artifacts/script-types-'));
 try {
  fs.mkdirSync(path.join(directory,'scripts'));
  fs.cpSync(path.join(__dirname,'../plugin/types'),path.join(directory,'types'),{recursive:true});
  const script=path.join(directory,'scripts/victory.js'),globals=path.join(directory,'api.d.ts');
  fs.writeFileSync(script,example.code);
  fs.writeFileSync(globals,"declare const pokevin: import('./types/script-ui').ScriptAPI;\n");
  const check=require('node:child_process').spawnSync(path.join(__dirname,'../node_modules/.bin/tsc'),[
   '--ignoreConfig','--allowJs','--checkJs','--strict','--noEmit','--skipLibCheck','--target','ES2022','--moduleResolution','Bundler','--module','ESNext',script,globals,
  ],{encoding:'utf8'});
  assert.equal(check.status,0,check.stdout+check.stderr);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('throwing cleanup cannot prevent other callbacks or scripts from stopping',()=>{
 const defaults=[{id:'a',name:'A',autoStart:true,code:"pokevin.ui.observe('body',()=>{},()=>{throw new Error('cleanup failed')});pokevin.events.onChapterStarted(()=>{globalThis.aRan=true});"},
 {id:'b',name:'B',autoStart:true,code:"pokevin.ui.observe('body',()=>{},()=>{globalThis.cleanedB=true});pokevin.events.onChapterStarted(()=>{globalThis.bRan=true});"}];
 const env=setup(undefined,undefined,defaults,true);
 assert.doesNotThrow(()=>env.api.stop());
 assert.equal(env.errors.length,1);assert.equal(env.context.cleanedB,true);
 assert.ok(env.library().scripts.every(script=>script.autoStart===false));
 env.write(adv());env.write(adv({chapter:15}));
 assert.equal(env.context.aRan,undefined);assert.equal(env.context.bRan,undefined);
 assert.doesNotThrow(()=>env.api.stop());assert.equal(env.errors.length,1);
 const reloaded=setup(env.library(),undefined,defaults,true);
 assert.equal(reloaded.context.cleanedB,undefined);
});
