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
    VERSION_WARNING: '', console: { error: error => errors.push(error) },
    CSS: { supports: () => true }, crypto: { randomUUID: () => 'test' },
    MutationObserver: class { observe() {} }, setInterval: fn => { refresh = fn; },
    setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} },
    document: {
      documentElement: {}, scripts: [], addEventListener() {}, createElement: () => new Element(),
      querySelector: () => chapter === null ? null : { querySelector: selector =>
        selector === '.mp-go[data-go], [data-zone]' ? { dataset: { go: String(chapter) } } :
          selector === '.mp-in > .mp-chips' ? container : null },
    },
    PokevinCreateBattles(owned, active) {
      return { prepare() {
        if (!active()) throw new Error('Script arrêté.');
        let open = true;
        const close = () => { open = false; closed++; owned.delete(close); };
        owned.add(close);
        return { fight() { if (!open) throw new Error('Simulation fermée.'); }, close };
      } };
    },
  };
  const source = fs.readFileSync(require.resolve('../plugin/sdk/ui.js'), 'utf8').replace(/^import .*;$/m, '');
  vm.runInNewContext(source, context);
  return { api: context.PokevinCreateUI(cleanups, () => enabled), container, errors,
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
