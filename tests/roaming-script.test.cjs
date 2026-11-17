const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../plugin/scripts/roaming-timeline.js'), 'utf8');
function setup(catalog = () => Promise.resolve({ species: [{id:243,name:'Raikou'}], bundle: 'game.js' })) {
  let writes = 0; const errors = [];
  class Image {
    constructor() { this.attrs = {}; this.isConnected = false; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    set className(value) { writes++; this.attrs.class = value; }
    setAttribute(key,value) { writes++; this.attrs[key] = value; }
    remove() { this.isConnected = false; if (step.image === this) step.image = null; }
  }
  const step = {image:null,classList:{contains:()=>true},querySelector:()=>step.image,append(image){this.image=image;image.isConnected=true;}};
  const timeline = {querySelectorAll:()=>[step]};
  let active = true;
  let save = {adv:{nodes:[{type:'wild',roamer:243}]},roam:{at:{243:{until:0}},caught:[]}}, update, stop, calls=0;
  const doc = {scripts:[{src:'https://game/game.js'}],createElement:()=>new Image()};
  const context = {console:{error:error=>errors.push(error)},document:doc,URL,pokevin:{saves:{read:()=>{if(save instanceof Error)throw save;return structuredClone(save);}},catalog:()=>{calls++;return catalog();},ui:{versionWarning:()=>doc.scripts.length?'':'Version du jeu différente',observe(selector,cb,cleanup){assert.equal(selector,'#timeline');update=()=>{if(active)cb([timeline]);};stop=()=>{active=false;cleanup();};update();}}}};
  vm.runInNewContext(source,context);
  return {step,doc,errors,writes:()=>writes,state:save,update:()=>update(),stop:()=>stop(),calls:()=>calls,setSave:next=>{save=next;}};
}
test('built-in owns assigned encounter, names, version warning, capture and cleanup without saving',async()=>{
  const env=setup(),before=JSON.stringify(env.state);
  await Promise.resolve();env.update();
  assert.equal(env.step.image.getAttribute('alt'),'Raikou');
  assert.equal(env.step.image.getAttribute('title'),'');
  assert.equal(JSON.stringify(env.state),before);
  const writes=env.writes();
  for(let i=0;i<5;i++) env.update();
  assert.equal(env.writes(),writes,'unchanged rendering must not trigger more DOM mutations');
  assert.equal(env.calls(),1);
  env.state.roam.at[243]={ch:20,until:0};env.update();
  assert.equal(env.step.image.getAttribute('data-id'),'243');
  env.doc.scripts=[];env.update();
  assert.equal(env.step.image.getAttribute('title'),'Version du jeu différente');
  env.state.roam.caught=[243];env.update();assert.equal(env.step.image,null);
  env.state.roam.caught=[];env.update();assert.ok(env.step.image);
  env.stop();assert.equal(env.step.image,null);env.update();assert.equal(env.step.image,null);
});
test('invalid saves and special adventures cannot project a roamer; late catalog cannot revive stopped script',async()=>{
  let finish;const env=setup(()=>new Promise(resolve=>{finish=resolve;}));
  env.stop();finish({species:[{id:243,name:'Raikou'}]});await Promise.resolve();assert.equal(env.step.image,null);
  for (const adv of [{nodes:[{type:'wild',roamer:-1}]},{nodes:[{type:'wild',roamer:243}],tower:true},{nodes:[]}]) {
    const next=setup();next.setSave({adv,roam:{caught:[]}});next.update();assert.equal(next.step.image,null);next.stop();
  }
});

test('invalid save reads remove stale sprites and report the error',()=>{
  const env=setup();assert.ok(env.step.image);env.setSave(new Error('Invalid save'));
  assert.throws(()=>env.update(),/Invalid save/);assert.equal(env.step.image,null);env.stop();
});

test('catalog failure is reported and the next observation retries without removing the sprite',async()=>{
  let calls=0;const env=setup(()=>++calls===1?Promise.reject(new Error('Offline')):Promise.resolve({species:[{id:243,name:'Raikou'}],bundle:'game.js'}));
  await new Promise(setImmediate);assert.ok(env.step.image);assert.equal(env.errors.length,1);
  env.update();await new Promise(setImmediate);env.update();
  assert.equal(env.step.image.getAttribute('alt'),'Raikou');assert.equal(env.calls(),2);env.stop();
});
