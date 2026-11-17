const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.style = {}; this.attributes = new Map(); }
    append(child) { child.remove(); this.children.push(child); child.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    addEventListener() {}
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
  }
  let chapter = 0, refresh, closed = 0, enabled = true;
  const container = new Element(), cleanups = new Set(), errors = [];
  const context = {
    URL, VERSION_WARNING: 'Version différente', console: { error: error => errors.push(error) },
    CSS: { supports: () => true }, crypto: { randomUUID: () => 'test' },
    MutationObserver: class { observe() {} disconnect() {} }, clearInterval() {}, setInterval: fn => { refresh ??= fn; },
    setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} },
    document: {
      documentElement: {}, scripts: [], addEventListener() {}, createElement: () => new Element(),
      querySelectorAll: () => [],
      querySelector: () => chapter === null ? null : { querySelector: selector =>
        selector === '.mp-go[data-go], [data-zone]' ? { dataset: { go: String(chapter) } } :
          selector === '.mp-in .mp-chips' ? container : null },
    },
    PokevinCreateSDK(owned, active) {
      return {simulate() {}, battles: { prepare() {
        if (!active()) throw new Error('Script arrêté.');
        let open = true;
        const close = () => { open = false; closed++; owned.delete(close); };
        owned.add(close);
        return { fight() { if (!open) throw new Error('Simulation fermée.'); }, close };
      } } };
    },
  };
  const source = fs.readFileSync(require.resolve('../plugin/sdk/ui.js'), 'utf8').replace(/^import .*;$/m, '');
  vm.runInNewContext(source, context);
  return { api: context.PokevinCreateUI(cleanups, () => enabled), container, errors, scripts: context.document.scripts,
    navigate(next) { chapter = next; refresh(); }, closed: () => closed,
    stop() { enabled = false; for (const cleanup of cleanups) cleanup(); },
  };
}

test('onViewed owns badges and battles across navigation, close, unsubscribe and script stop', () => {
  const env = setup(), visits = [];
  const off = env.api.chapters.onViewed((view, scope) => {
    if (!view) return;
    visits.push({ scope, badge: scope.ui.chapterBadge(view.chapterId, { text: `Chapter ${view.chapterId}` }), battle: scope.battles.prepare() });
  });
  assert.equal(env.container.children.length, 1);
  env.navigate(1);
  assert.equal(env.closed(), 1);
  assert.equal(env.container.children.length, 1);
  const previous = visits[0];
  assert.throws(() => previous.battle.fight(), /fermée/);
  assert.throws(() => previous.scope.battles.prepare(), /arrêté/);
  assert.throws(() => previous.scope.ui.chapterBadge(1, { text: 'Stale' }), /arrêté/);
  previous.badge.update({ text: 'Late result' });
  assert.equal(env.container.children[0].children[0].children[0].textContent, 'Chapter 1');
  env.navigate(null);
  assert.equal(env.closed(), 2);
  assert.equal(env.container.children.length, 0);
  env.navigate(1);
  assert.equal(visits.length, 3);
  off(); off();
  assert.equal(env.closed(), 3);
  env.navigate(0);
  assert.equal(visits.length, 3);
  env.api.chapters.onViewed((view, scope) => {
    if (view) { scope.ui.chapterBadge(view.chapterId, { text: 'Last' }); scope.battles.prepare(); }
  });
  env.stop();
  assert.equal(env.closed(), 4);
  assert.equal(env.container.children.length, 0);
  assert.deepEqual(env.errors, []);
});

test('late async completions cannot revive an old visit, including a reopened chapter', async () => {
  const env = setup(), finish = [];
  const off = env.api.chapters.onViewed(async (view, { ui }) => {
    if (!view) return;
    const badge = ui.chapterBadge(view.chapterId, { text: 'Pending' });
    await new Promise(resolve => finish.push(resolve));
    badge.update({ text: 'Done' });
  });
  env.navigate(null); env.navigate(0);
  finish[0](); await Promise.resolve();
  assert.equal(env.container.children.length, 1);
  assert.equal(env.container.children[0].children[0].children[0].textContent, 'Pending');
  finish[1](); await Promise.resolve();
  assert.equal(env.container.children[0].children[0].children[0].textContent, 'Done');
  off();
});

test('DOM observers isolate scripts and cancel queued work before cleaning up once', () => {
  const intervals = new Map(), pending = new Map(), observers = [], errors = [];
  let nextId = 0;
  class Element {
    closest() { return this; }
  }
  const row = new Element();
  const context = {
    VERSION_WARNING: '', Element, console: {error: error => errors.push(error)},
    setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = ++nextId; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
    document: {documentElement: {}, addEventListener() {}, querySelector: () => null,
      querySelectorAll: () => [row]},
  };
  const source = fs.readFileSync(require.resolve('../plugin/sdk/ui.js'), 'utf8').replace(/^import .*;$/m, '');
  vm.runInNewContext(source, context);
  const a = new Set(), b = new Set();
  let aCalls = 0, bCalls = 0, cleaned = 0;
  const off = context.PokevinCreateUI(a, () => true).ui.observe('.row', rows => {
    assert.equal(rows[0], row);
    aCalls++;
    throw new Error('script A failed');
  }, () => { cleaned++; });
  context.PokevinCreateUI(b, () => true).ui.observe('.row', () => { bCalls++; });
  assert.equal(aCalls, 1); assert.equal(bCalls, 1); assert.equal(errors.length, 1);
  for (const observer of observers.slice(1)) observer.callback([{target: row, addedNodes: [], removedNodes: []}]);
  off(); off();
  for (const fn of pending.values()) fn();
  pending.clear();
  assert.equal(aCalls, 1); assert.equal(bCalls, 2); assert.equal(cleaned, 1);
  assert.equal(a.size, 0); assert.equal(observers[1].connected, false);
  for (const cleanup of b) cleanup();
  assert.equal(intervals.size, 1, 'only the chapter SDK interval remains');
});

test('shared version warning ignores malformed URLs and compares exact bundle filenames', () => {
  const env = setup();
  env.scripts.push({src: 'invalid'}, {src: 'https://game/bundle/app.js?cache=1'});
  assert.equal(env.api.ui.versionWarning('app.js'), '');
  assert.equal(env.api.ui.versionWarning('other-app.js'), 'Version différente');
});

test('leaving a visit continues closing badges and battles after a cleanup fails',()=>{
 const env=setup();
 env.api.chapters.onViewed((view,scope)=>{
  if(!view)return;
  scope.ui.observe('body',()=>{},()=>{throw new Error('visit cleanup failed')});
  scope.ui.chapterBadge(view.chapterId,{text:'Owned badge'});
  scope.battles.prepare();
 });
 assert.equal(env.container.children.length,1);
 assert.doesNotThrow(()=>env.navigate(null));
 assert.equal(env.container.children.length,0);
 assert.equal(env.closed(),1);assert.equal(env.errors.length,1);
});
