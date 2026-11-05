const assert = require('node:assert/strict');
const { test } = require('node:test');
require('../engine/core.js');
require('../simulator.js');
require('../encounter-simulator.js');
require('../chapter-xp.js');
const { Game, STORY, CONFIG, Adventure } = PokeCatchEngine;
const NOW = Date.UTC(2026, 10, 4, 12);

function fixture(chapter = 0, ids = [1, 4, 7], level = 10) {
  const save = Game.freshState();
  save.mons = ids.map((id, i) => ({ ...Game.makeMon(id, level, { shiny: false }), uid: `xp-${i}` }));
  save.team = save.mons.map(mon => mon.uid);
  save.adv = { chapter, unlocked: chapter, nodes: [], node: 0, layout: 6,
    badges: [], gifts: { starter: true }, kept: {}, speed: 1 };
  save.travel = { to: STORY.REGIONS.filter(region => region.key &&
    STORY.firstChapterOf(region.key) <= chapter).map(region => region.key) };
  return save;
}

function estimate(save, chapter = save.adv.chapter) {
  const random = Math.random;
  let seed = 123;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    const iterator = ChapterXP.estimate(save, chapter, NOW);
    let result;
    do { result = iterator.next(); } while (!result.done);
    return result.value;
  } finally { Math.random = random; }
}

test('XP/h measures complete routes, uses effective speed, and preserves the save', () => {
  const save = fixture(), before = JSON.stringify(save);
  const step = Adventure.step;
  let actions = 0, xp = 0, heals = 0, wild = 0, trainers = 0;
  Adventure.step = () => {
    actions++;
    const events = step();
    for (const event of events) {
      if (event.type === 'xp' && save.team.includes(event.uid)) xp += event.amount;
      if (event.type === 'heal') heals++;
      if (event.type === 'battleStart' && event.kind === 'wild') wild++;
      if (event.type === 'battleStart' && event.kind === 'trainer') trainers++;
    }
    return events;
  };
  let normal;
  try { normal = estimate(save); } finally { Adventure.step = step; }
  assert.equal(JSON.stringify(save), before);
  assert.equal(normal.runs, 20);
  assert.equal(normal.completed + normal.defeats, 20);
  assert.equal(normal.xp, xp);
  assert.equal(normal.elapsedMs, actions * CONFIG.ACTION_MS);
  assert.equal(normal.xpPerHour, xp * 3600000 / normal.elapsedMs);
  assert.ok(heals > 0 && wild > 0 && trainers > 0 && xp > 0);
  for (const [setting, multiplier] of [[2, 2], [4, 2.5]]) {
    save.adv.speed = setting;
    const faster = estimate(save);
    assert.equal(faster.speed, multiplier);
    assert.equal(faster.xp, normal.xp);
    assert.ok(Math.abs(faster.xpPerHour / normal.xpPerHour - multiplier) < 1e-8);
  }
  assert.equal(Game.S, undefined);
});

test('losing teams retain partial XP and defeat time; level capped teams earn zero', () => {
  const save = fixture(0, [129], 1);
  const loss = estimate(save);
  assert.equal(loss.defeats, 20);
  assert.equal(loss.completed, 0);
  assert.ok(loss.elapsedMs > 0 && Number.isFinite(loss.xpPerHour));
  const capped = estimate(fixture(0, [150], 100));
  assert.equal(capped.xpPerHour, 0);
});

test('a league selection simulates the whole circuit', () => {
  const chapter = STORY.CHAPTERS.findIndex(chapter => chapter.league);
  const save = fixture(chapter + 1, [150], 100);
  const result = estimate(save);
  assert.equal(result.league, true);
  assert.equal(result.completed + result.defeats, 20);
  assert.ok(result.elapsedMs > 0);
});

test('native league targets resolve the complete circuit in each region', () => {
  for (const region of STORY.REGIONS.filter(region => region.key)) {
    const chapter = STORY.CHAPTERS.findIndex((entry, index) => entry.league && STORY.regionOf(index).key === region.key);
    const save = fixture(chapter + 1, [150], 100);
    assert.deepEqual(estimate(save, `league:${region.key}`), estimate(save, chapter));
    assert.throws(() => estimate(save, 'league:unknown'), /accessible/);
    save.adv.unlocked = chapter - 1;
    assert.throws(() => estimate(save, `league:${region.key}`), /accessible/);
  }
});

test('legendary zones measure the dedicated team, speed and defeats without changing the save', () => {
  const save = fixture(4, [76, 112, 143, 248, 3, 9], 100);
  save.mons.forEach(mon => { mon.shiny = true; mon.rank = 5; });
  save.mons[5].level = 10;
  save.eventTeams['zone:145'] = [...save.team];
  save.team = [save.mons[5].uid];
  save.road = [...save.team];
  const before = JSON.stringify(save);
  const result = estimate(save, 'zone:145');
  assert.ok(result.completed > 0);
  assert.equal(result.completed + result.defeats, 20);
  assert.ok(result.xp > 0 && result.xpPerHour > 0);
  assert.equal(result.league, false);
  assert.equal(JSON.stringify(save), before);
  save.adv.speed = 2;
  const fast = estimate(save, 'zone:145');
  assert.equal(fast.xp, result.xp);
  assert.ok(Math.abs(fast.xpPerHour / result.xpPerHour - 2) < 1e-8);
  save.eventTeams['zone:145'] = [save.mons[5].uid];
  assert.equal(estimate(save, 'zone:145').defeats, 20);
  assert.throws(() => estimate(save, 'zone:493'), /serveur/);
});

test('uses the road team and rejects locked chapters and incompatible saves', () => {
  const save = fixture(0, [129, 150], 1);
  save.mons[1].level = 100;
  save.road = [save.team[0]]; save.team = [save.team[1]];
  assert.equal(estimate(save).defeats, 20);
  assert.throws(() => estimate(save, 1), /accessible/);
  assert.throws(() => estimate(save, -1), /accessible/);
  assert.throws(() => estimate({ ...save, team: [], road: [] }), /équipe/);
});

test('unclaimed gifts do not block XP earned on an unfinished chapter or alter the save', () => {
  const save = fixture(1, [6], 15);
  const before = JSON.stringify(save);
  const result = estimate(save);
  assert.equal(result.defeats, 20);
  assert.equal(result.completed, 0);
  assert.ok(result.xp > 0 && result.xpPerHour > 0);
  assert.equal(JSON.stringify(save), before);
  assert.deepEqual(save.adv.gifts, { starter: true });
  assert.equal(save.mons.length, 1);
  save.adv.gifts.magikarp = true;
  save.adv.gifts.fossil = true;
  const withoutChoices = estimate(save);
  assert.equal(result.xp, withoutChoices.xp);
  assert.equal(result.elapsedMs, withoutChoices.elapsedMs);
});

test('canceling a yielded simulation releases the sandbox without changing the save', () => {
  const save = fixture(), before = JSON.stringify(save);
  const iterator = ChapterXP.estimate(save, 0, NOW);
  assert.equal(iterator.next().done, false);
  iterator.return();
  assert.equal(Game.S, undefined);
  assert.equal(JSON.stringify(save), before);
});

test('branching evolutions stop a chapter estimate instead of selecting a form', () => {
  const save = fixture(1, [3, 236], 50);
  save.adv.unlocked = 5;
  save.travel.to = ['kanto', 'johto'];
  save.mons[1].level = 19;
  Game.sandbox(save, () => { save.mons[1].xp = Game.xpForNext(19, save.mons[1]) - 1; });
  const before = JSON.stringify(save);
  assert.throws(() => estimate(save), /choix du joueur/);
  assert.equal(Game.S, undefined);
  assert.equal(JSON.stringify(save), before);
});
