const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(saved, example){
 class Storage {constructor(){this.values=new Map()}setItem(k,v){this.values.set(k,String(v))}getItem(k){return this.values.get(k)??null}}
 const pending=[], errors=[]; let subscriptions=0;
 const context={crypto:{randomUUID:require('node:crypto').randomUUID},PokevinExampleScript:{id:'example-victory-chance',name:'Calculateur',code:'pokevin.chapters.onViewed(() => {});',previousCodes:['old badge example','old scoped example'],legacyCode:'old console example'}, PokevinCreateUI:cleanups=>({ui:{},chapters:{onViewed:()=>{subscriptions++;const off=()=>{subscriptions--;cleanups.delete(off)};cleanups.add(off);return off}}}),addEventListener(){},Storage, localStorage:new Storage(), queueMicrotask:fn=>pending.push(fn), console:{error:(...args)=>errors.push(args)},
 document:{documentElement:{},addEventListener(){},querySelector:()=>null},MutationObserver:class{observe(){}}};
 if(example)context.PokevinExampleScript=example;
 if(saved)context.localStorage.setItem('pokevin-scripts',JSON.stringify(saved));
 context.window=context;
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

test('the visible built-in is the automatically running script and stopping persists across reloads',()=>{
 const ctx=setup({scripts:[{id:'mine',name:'Mine',code:'keep me'}],selectedId:'mine'});
 assert.equal(ctx.subscriptions(),1);
 assert.equal(ctx.library().scripts[0].code,'keep me');
 assert.equal(ctx.library().selectedId,'mine');
 assert.equal(ctx.library().scripts.find(s=>s.id==='example-victory-chance').autoStart,true);
 ctx.api.stop();
 assert.equal(ctx.subscriptions(),0);
 const reloaded=setup(ctx.library());
 assert.equal(reloaded.subscriptions(),0);
 assert.equal(reloaded.library().scripts.length,2);
});
test('migration upgrades the old console example, preserves edits, and respects deletion',()=>{
 const old={scripts:[{id:'example-victory-chance',name:'Example',code:'old console example'}],selectedId:'example-victory-chance',examplesVersion:1};
 const migrated=setup(old);
 assert.equal(migrated.subscriptions(),1);
 assert.match(migrated.library().scripts[0].code,/onViewed/);
 const edited=setup({...old,scripts:[{...old.scripts[0],code:'my custom code'}]});
 assert.equal(edited.subscriptions(),0);
 assert.equal(edited.library().scripts[1].code,'my custom code');
 const deleted=setup({scripts:[],selectedId:'',examplesVersion:2});
 assert.equal(deleted.subscriptions(),0);
 assert.equal(deleted.library().scripts.length,1);
});

test('migration updates the untouched badge example, preserving edits, stopped state and deletion',()=>{
 const old={scripts:[{id:'example-victory-chance',name:'Calculateur',code:'old badge example',autoStart:false}],selectedId:'example-victory-chance',examplesVersion:2};
 const migrated=setup(old);
 assert.match(migrated.library().scripts[0].code,/onViewed/);
 assert.equal(migrated.library().scripts[0].autoStart,false);
 assert.equal(migrated.library().examplesVersion,4);
 const edited=setup({...old,scripts:[{...old.scripts[0],code:'my custom code'}]});
 assert.equal(edited.library().scripts[1].code,'my custom code');
 assert.equal(setup({...old,scripts:[],selectedId:''}).library().scripts.length,1);
});

test('the real previous bundled script migrates to the simplified visit-scoped script',()=>{
 const context={source:fs.readFileSync(require.resolve('../plugin/scripts/victory-chance.js'),'utf8'),badgeSource:fs.readFileSync(require.resolve('../plugin/scripts/victory-badge.js'),'utf8')};
 const builder=fs.readFileSync(require.resolve('../plugin/scripts/victory-chance-example.js'),'utf8').replace(/^import .*;$/gm,'');
 vm.runInNewContext(builder,context);
 const example=context.PokevinExampleScript;
 assert.match(example.previousCodes[0],/const previous = current/);
 assert.doesNotMatch(example.code,/const previous = current|current !== job/);
 assert.match(example.code,/async function\* calculateVictoryChance\(battles, save, target\)/);
 assert.match(example.code,/const calculation = calculateVictoryChance\(battles, save, view.chapterId\)/);
 assert.match(example.code,/function getColor\(state\)/);
 assert.doesNotMatch(example.code,/globalThis\.PokevinVictoryChance|startVictoryBadge|const \w+ = (async )?function|\?/);
 assert.doesNotMatch(example.code,/\/\//);
 assert.match(example.code,/@param \{import\('\.\.\/types\/battles'\)\.Battles\} battles/);
 assert.doesNotMatch(example.code,/\n}\n(?:\/\*\*|(?:async )?function)/);
 const path=require('node:path');
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
 for(const [index,code] of example.previousCodes.entries()){
  const migrated=setup({scripts:[{id:example.id,name:example.name,code,autoStart:true}],selectedId:example.id,examplesVersion:index+2},example);
  assert.equal(migrated.library().scripts[0].code,example.code);
  assert.match(migrated.library().scripts[0].code,/startsWith\('league:'/);
 }
});

test('the previous scoped default gains League support without reactivating stopped scripts',()=>{
 const saved={scripts:[{id:'example-victory-chance',name:'Calculateur',code:'old scoped example',autoStart:false}],selectedId:'example-victory-chance',examplesVersion:3};
 const migrated=setup(saved);
 assert.match(migrated.library().scripts[0].code,/onViewed/);
 assert.equal(migrated.library().scripts[0].autoStart,false);
 assert.equal(setup({...saved,scripts:[]}).library().scripts.length,1);
});

test('bundled source changes update untouched copies without version bumps or historical code lists',()=>{
 const first=setup();
 const example={...first.context.PokevinExampleScript,code:'// v2\npokevin.chapters.onViewed(() => {});',previousCodes:[]};
 const second=setup(first.library(),example);
 assert.equal(second.library().scripts[0].code,example.code);
 assert.equal(second.library().exampleCode,example.code);
 assert.equal(second.subscriptions(),1);
 const third=setup(second.library(),{...example,code:'// v3\npokevin.chapters.onViewed(() => {});'});
 assert.match(third.library().scripts[0].code,/v3/);
 assert.equal(third.library().examplesVersion,first.library().examplesVersion);
});

test('automatic source updates back up edits and restore deleted built-ins in the stopped state',()=>{
 const initial=setup();
 initial.api.stop();
 const saved=initial.library();
 const example={...initial.context.PokevinExampleScript,code:'// next\npokevin.chapters.onViewed(() => {});',previousCodes:[]};
 const stopped=setup(saved,example);
 assert.equal(stopped.library().scripts[0].code,example.code);
 assert.equal(stopped.subscriptions(),0);
 const edited=setup({...saved,scripts:[{...saved.scripts[0],code:'my custom code'}]},example);
 assert.equal(edited.library().scripts[1].code,'my custom code');
 const deleted=setup({...saved,scripts:[],selectedId:''},example);
 assert.equal(deleted.library().scripts.length,1);
 assert.equal(deleted.library().exampleCode,example.code);
});

test('an edited bundled script is restored with exactly one personal backup',()=>{
 const initial=setup(); initial.api.stop();
 const saved=initial.library();
 saved.scripts[0].code='// custom changes';
 const example={...initial.context.PokevinExampleScript};
 const refreshed=setup(saved,example);
 assert.equal(refreshed.library().scripts[0].code,example.code);
 assert.equal(refreshed.library().scripts[0].autoStart,false);
 assert.equal(refreshed.library().scripts[1].code,'// custom changes');
 assert.equal(refreshed.library().scripts[1].autoStart,false);
 assert.match(refreshed.library().scripts[1].name,/copie personnelle/);
 assert.equal(refreshed.subscriptions(),0);
 const reloaded=setup(refreshed.library(),example);
 assert.equal(reloaded.library().scripts.length,2);
 assert.equal(setup({...saved,scripts:[]},example).library().scripts.length,1);
});
