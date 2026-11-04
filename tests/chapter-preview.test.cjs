const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
require('../ui/chapter-data.js');
const { chapters, bundle } = globalThis.PokeCatchChapterData;

test('preview includes route trainers and gym assistants before the champion', () => {
  assert.equal(bundle, 'app.c4d608a3a9.js');
  assert.equal(chapters.length, 66);
  const [route, assistant, champion] = chapters[0].trainers;
  assert.equal(route.location, 'Forêt de Jade');
  assert.equal(route.count, 2);
  assert.deepEqual(route.size, [1, 2]);
  assert.ok(route.team.some(mon => mon.id === 12), 'Include the evolved trainer Pokémon');
  assert.ok(route.team.every(mon => mon.min <= mon.max));
  assert.equal(assistant.name, 'Assistant d’arène 1');
  assert.deepEqual(assistant.size, [1, 1]);
  assert.deepEqual(assistant.team.map(mon => [mon.name, mon.min, mon.max]), [['Racaillou', 11, 11], ['Onix', 11, 11]]);
  assert.equal(champion.name, 'Pierre');
  assert.deepEqual(champion.team.map(mon => [mon.name, mon.level]), [['Racaillou', 14], ['Onix', 15]]);
  assert.equal(chapters[1].trainers.filter(trainer => trainer.name.startsWith('Assistant')).length, 2);
});

test('fixed teams retain their order and duplicates, random pools are valid across every region', () => {
  const kimono = chapters.find(chapter => chapter.trainers.some(trainer => trainer.name === 'Kimono Sayo'));
  const fixed = kimono.trainers.filter(trainer => !trainer.random);
  assert.deepEqual(fixed.slice(0, 5).map(trainer => trainer.name),
    ['Kimono Sayo', 'Kimono Zuki', 'Kimono Kuni', 'Kimono Miki', 'Kimono Naoko']);
  assert.equal(fixed.at(-1).name, 'Mortimer');
  assert.equal(fixed.at(-1).team.filter(mon => mon.id === 93).length, 2);
  for (const chapter of chapters) {
    for (const trainer of chapter.trainers) {
      assert.ok(trainer.name && trainer.location && trainer.team.length);
      if (trainer.random) {
        assert.ok(trainer.count > 0 && trainer.classes.length > 0);
        assert.equal(new Set(trainer.team.map(mon => mon.id)).size, trainer.team.length);
        assert.ok(trainer.size[0] <= trainer.size[1]);
      }
      for (const mon of trainer.team) {
        assert.ok(mon.name && mon.id > 0);
        assert.ok(trainer.random ? mon.min > 0 && mon.max <= 100 && mon.min <= mon.max : mon.level > 0 && mon.level <= 100);
      }
    }
  }
});

test('extractor rejects an incompatible bundle', () => {
  const { extract } = require('../tools/build_chapter_preview.cjs');
  assert.throws(() => extract(''), /Sections du jeu introuvables/);
});

test('native random battles fit the displayed team sizes, Pokémon and level ranges', { skip: !process.env.GAME_PREVIEW_BUNDLE }, () => {
  const { loadGame } = require('../tools/build_chapter_preview.cjs');
  const { Game, Adventure, STORY, DAYTIME } = loadGame(fs.readFileSync(process.env.GAME_PREVIEW_BUNDLE, 'utf8'));
  let checked = 0;
  for (let chapter = 0; chapter < STORY.CHAPTERS.length; chapter++) {
    if (STORY.CHAPTERS[chapter].league) continue;
    const state = Game.freshState();
    state.adv = { chapter, unlocked: chapter, badges: [], gifts: {}, kept: {}, nodes: [], layout: 6 };
    Game.sandbox(state, () => {
      state.mons = [Game.makeMon(3, 100, { shiny: false })];
      state.team = state.mons.map(mon => mon.uid); state.road = [...state.team];
      Adventure.buildChapter(chapter);
      for (const phase of ['day', 'night']) {
        DAYTIME.force(phase);
        for (const [index, node] of state.adv.nodes.entries()) {
          if (node.type !== 'trainer' || node.team) continue;
          const candidates = chapters[chapter].trainers.filter(trainer => trainer.random && trainer.location === node.name);
          for (let trial = 0; trial < 4; trial++) {
            state.adv.node = index; state.adv.battle = null; state.adv.pending = null;
            Game.healTeam();
            const battle = Adventure.step().find(event => event.type === 'battleStart');
            assert.ok(battle, `Combat absent : ${chapter} / ${node.name}`);
            assert.ok(candidates.some(trainer => battle.enemies.length >= trainer.size[0] && battle.enemies.length <= trainer.size[1] &&
              battle.enemies.every(mon => trainer.team.some(possible => possible.id === mon.id && mon.level >= possible.min && mon.level <= possible.max))),
            `Équipe inattendue : ${chapter} / ${node.name} / ${battle.enemies.map(mon => `${mon.id}:${mon.level}`)}`);
            checked++;
          }
        }
      }
    });
  }
  assert.ok(checked > 3000);
});
