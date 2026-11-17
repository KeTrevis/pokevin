const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

test('built-in preserves native countdowns across ticks, berries, redraws, stop and restart', async () => {
  const egg = new Map([['title', 'Un œuf toutes les 6 h 00 (1 Pokémon) · prochain dans 2 h 15']]);
  const xp = new Map([['title', "Prochain gain d’XP dans 2 min"]]);
  class Element {
    constructor(attributes) { this.attributes = attributes; }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    closest() { return this; }
  }
  const row = attributes => new Element(attributes);
  let rows = [row(egg), row(xp)];
  const observers = [], intervals = new Set(), cleanups = new Set();
  let active = true;
  const context = {
    console, Element, setTimeout, clearTimeout,
    setInterval(callback) { intervals.add(callback); return callback; },
    clearInterval(callback) { intervals.delete(callback); },
    document: {
      documentElement: {}, addEventListener() {}, querySelector: () => null,
      querySelectorAll: selector => selector === '#pen-res .pen-row' ? rows : [],
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
  };
  const sdk = fs.readFileSync(require.resolve('../plugin/sdk/ui.js'), 'utf8').replace(/^import .*;$/m, '');
  vm.runInNewContext(sdk, context);
  const source = fs.readFileSync(require.resolve('../plugin/scripts/pension-countdown.js'), 'utf8');
  const start = () => {
    active = true;
    // Execute the exact built-in against its public scoped UI API.
    vm.runInNewContext(source, { pokevin: context.PokevinCreateUI(cleanups, () => active) });
  };
  const refresh = async () => {
    for (const observer of observers) if (observer.connected) observer.callback([{target: rows[0], addedNodes: [], removedNodes: []}]);
    await new Promise(resolve => setTimeout(resolve, 10));
  };
  start();
  assert.equal(egg.get('data-pc-egg-next'), 'prochain dans 2 h 15');
  assert.equal(xp.has('data-pc-egg-next'), false);
  egg.delete('data-pc-egg-next');
  await refresh();
  assert.equal(egg.get('data-pc-egg-next'), 'prochain dans 2 h 15');
  egg.set('title', 'Un œuf toutes les 6 h 00 (1 Pokémon) · prochain dans 1 min');
  await refresh();
  assert.equal(egg.get('data-pc-egg-next'), 'prochain dans 1 min');
  const translated = new Map([['title', 'An egg every 6 h 00 (1 Pokémon) · next in 3 h 00']]);
  rows = [row(translated)];
  await refresh();
  assert.equal(translated.get('data-pc-egg-next'), 'next in 3 h 00');
  translated.set('title', 'Incubateur plein');
  await refresh();
  assert.equal(translated.has('data-pc-egg-next'), false);
  translated.set('title', 'An egg every 6 h 00 · next in 1 min');
  await refresh();
  translated.delete('title');
  await refresh();
  assert.equal(translated.has('data-pc-egg-next'), false);
  translated.set('title', 'An egg every 6 h 00 · next in 1 min');
  await refresh();
  // Stop before the observer's pending refresh: it must not revive the display.
  for (const observer of observers) if (observer.connected) observer.callback([{target: rows[0], addedNodes: [], removedNodes: []}]);
  active = false;
  for (const cleanup of [...cleanups]) cleanup();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(translated.has('data-pc-egg-next'), false);
  assert.equal(cleanups.size, 0);
  assert.equal(intervals.size, 1, 'only the chapter SDK interval remains');
  await refresh();
  assert.equal(translated.has('data-pc-egg-next'), false);
  start();
  assert.equal(translated.get('data-pc-egg-next'), 'next in 1 min');
  active = false;
  for (const cleanup of [...cleanups]) cleanup();
  assert.equal(translated.has('data-pc-egg-next'), false);
});
