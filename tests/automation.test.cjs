const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
 class Storage {constructor(){this.values=new Map()}setItem(k,v){this.values.set(k,String(v))}getItem(k){return this.values.get(k)??null}}
 const pending=[], errors=[];
 const context={addEventListener(){},Storage, localStorage:new Storage(), queueMicrotask:fn=>pending.push(fn), console:{error:(...args)=>errors.push(args)},
 document:{documentElement:{},addEventListener(){},querySelector:()=>null},MutationObserver:class{observe(){}}};
 context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../automation.js'),'utf8'),context);
 const write=adv=>{context.localStorage.setItem('gachamon-save-v1',JSON.stringify({fmt:2,adv}));while(pending.length)pending.shift()()};
 return {api:context.pokevin,write,errors,context};
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
