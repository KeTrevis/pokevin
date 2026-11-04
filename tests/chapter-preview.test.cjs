const assert = require('node:assert/strict');
const test = require('node:test');
require('../ui/chapter-data.js');
const { chapters, bundle } = globalThis.PokeCatchChapterData;

test('preview includes ordered fixed trainers, scaled levels and duplicate Pokémon', () => {
  assert.equal(bundle, 'app.c4d608a3a9.js');
  assert.equal(chapters.length, 66);
  assert.equal(chapters[0].trainers[0].name, 'Pierre');
  assert.deepEqual(chapters[0].trainers[0].team.map(mon => [mon.name, mon.level]),
    [['Racaillou', 14], ['Onix', 15]]);
  const kimono = chapters.find(chapter => chapter.trainers.some(trainer => trainer.name === 'Kimono Sayo'));
  assert.deepEqual(kimono.trainers.slice(0, 5).map(trainer => trainer.name),
    ['Kimono Sayo', 'Kimono Zuki', 'Kimono Kuni', 'Kimono Miki', 'Kimono Naoko']);
  assert.equal(kimono.trainers.at(-1).name, 'Mortimer');
  assert.equal(kimono.trainers.at(-1).team.filter(mon => mon.id === 93).length, 2);
  assert.ok(chapters.some(chapter => !chapter.trainers.length));
  for (const chapter of chapters) {
    assert.ok(Number.isInteger(chapter.randomTrainers) && chapter.randomTrainers >= 0);
    for (const trainer of chapter.trainers) {
      assert.ok(trainer.name && trainer.location && trainer.team.length);
      for (const mon of trainer.team) assert.ok(mon.name && mon.id > 0 && mon.level > 0 && mon.level <= 100);
    }
  }
});

test('extractor uses game level functions and rejects missing source sections', () => {
  const { extract } = require('../tools/build_chapter_preview.cjs');
  assert.throws(() => extract(''), /Section du jeu introuvable/);
  const source = `t.POKEDEX=[{id:25,name:'Pikachu'}],t.I18n={};
    t.STORY={CHAPTERS:[{steps:[{kind:'trainer',trainer:'Test',name:'Route',sprite:'red',team:[[25,5]]}]}],
      trainerTeam:(chapter,step)=>step.team.map(([id,level])=>[id,level+10])},t.SCENES={};`;
  assert.equal(extract(source)[0].trainers[0].team[0].level, 15);
});
