const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
require('../ui/chapter-data.js');
require('../engine/core.js');
const { chapters, bundle } = globalThis.PokeCatchChapterData;

test('only gym champions and League members are included, with ordered teams and native card metadata', () => {
  const { STORY, CONFIG } = PokeCatchEngine;
  assert.equal(bundle, require('../engine/version.json').bundle);
  assert.equal(chapters.length, STORY.CHAPTERS.length);
  for (const [index, chapter] of chapters.entries()) {
    const native = STORY.CHAPTERS[index];
    const gyms = native.steps.filter(step => step.kind === 'gym' && (native.league || (step.badge && !step.champion)));
    assert.equal(chapter.region, STORY.regionOf(index).key);
    assert.equal(chapter.league, !!native.league);
    assert.equal(chapter.trainers.length, gyms.length);
    for (const [i, trainer] of chapter.trainers.entries()) {
      assert.equal(trainer.name, gyms[i].leader);
      assert.deepEqual(trainer.team.map(mon => [mon.id, mon.level]), STORY.gymTeam(index, gyms[i]));
      assert.equal(trainer.cap, Math.min(CONFIG.MAX_LEVEL, STORY.capOf(index)));
      assert.ok(trainer.typeName && trainer.color && trainer.sprite);
    }
  }
  assert.deepEqual(chapters[0].trainers.map(trainer => trainer.name), ['Pierre']);
  assert.deepEqual(chapters[0].trainers[0].team.map(mon => mon.name), ['Racaillou', 'Onix']);
  const mortimer = chapters.flatMap(chapter => chapter.trainers).find(trainer => trainer.name === 'Mortimer');
  assert.equal(mortimer.team.filter(mon => mon.id === 93).length, 2, 'Keep duplicate Pokémon');
});

test('extractor rejects an incompatible bundle', () => {
  const { extract } = require('../tools/build_chapter_preview.cjs');
  assert.throws(() => extract(''), /Sections du jeu introuvables/);
});

test('display data is extracted from the current real game bundle', { skip: !process.env.GAME_PREVIEW_BUNDLE }, () => {
  const { extract } = require('../tools/build_chapter_preview.cjs');
  assert.equal(JSON.stringify(extract(fs.readFileSync(process.env.GAME_PREVIEW_BUNDLE, 'utf8'))), JSON.stringify(chapters));
});
