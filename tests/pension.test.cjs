const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

test('shows the native egg countdown and follows ticks, berries and redraws', () => {
  const egg = new Map([['title', 'Un œuf toutes les 6 h 00 (1 Pokémon) · prochain dans 2 h 15']]);
  const xp = new Map([['title', "Prochain gain d’XP dans 2 min"]]);
  const row = attributes => ({
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
  });
  let rows = [row(egg), row(xp)];
  let refresh;
  vm.runInNewContext(fs.readFileSync(require.resolve('../ui/pension.js'), 'utf8'), {
    document: { body: {}, querySelectorAll: () => rows },
    MutationObserver: class {
      constructor(callback) { refresh = callback; }
      observe(_body, options) {
        assert.deepEqual(Array.from(options.attributeFilter), ['title', 'data-pc-egg-next']);
      }
    },
  });
  assert.equal(egg.get('data-pc-egg-next'), 'prochain dans 2 h 15');
  assert.equal(xp.has('data-pc-egg-next'), false);

  egg.delete('data-pc-egg-next');
  refresh();
  assert.equal(egg.get('data-pc-egg-next'), 'prochain dans 2 h 15');

  egg.set('title', 'Un œuf toutes les 6 h 00 (1 Pokémon) · prochain dans 1 min');
  refresh();
  assert.equal(egg.get('data-pc-egg-next'), 'prochain dans 1 min');

  const translated = new Map([['title', 'An egg every 6 h 00 (1 Pokémon) · next in 3 h 00']]);
  rows = [row(translated)];
  refresh();
  assert.equal(translated.get('data-pc-egg-next'), 'next in 3 h 00');

  translated.set('title', 'Incubateur plein');
  refresh();
  assert.equal(translated.has('data-pc-egg-next'), false);
});
