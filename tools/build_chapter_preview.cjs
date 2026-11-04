// Extract display data only; never ship or execute downloaded game scripts in the extension.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function loadGame(source) {
  const end = source.indexOf(',t.Underground=');
  const anchor = 't.Adventure={ensure:de';
  if (end < 0 || !source.includes(anchor)) throw new Error('Sections du jeu introuvables.');
  const context = { console, performance, Date, structuredClone, AbortController,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    document: { documentElement: {}, addEventListener() {} },
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/' },
    localStorage: { getItem: () => null, setItem() {} },
    LANG_PICK: { lang: 'fr', pref: 'fr', LANGS: ['fr'] },
    addEventListener() {}, dispatchEvent() {},
    CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async () => ({ headers: { get: () => new Date().toUTCString() } }),
  };
  // Expose the native encounter helpers only inside this offline build sandbox.
  const core = source.slice(0, end).replace(anchor,
    't.Adventure={previewPool:z,previewGymTrainers:pa,previewEvolutions:ut,previewEvolve:nt,ensure:de');
  vm.runInNewContext(core + ';globalThis.Reference=t;})();', context, { timeout: 5000 });
  return context.Reference;
}

function extract(source) {
  const { STORY, Game, Adventure, CONFIG, DAYTIME, WEATHER } = loadGame(source);
  const state = Game.freshState();
  state.adv = { chapter: 0, unlocked: 0, badges: [], gifts: {}, kept: {}, nodes: [], layout: 6 };
  return Game.sandbox(state, () => STORY.CHAPTERS.map((chapter, index) => {
    state.adv.chapter = index;
    const routes = chapter.steps.filter(step => step.kind === 'route');
    const trainers = [];
    const addRandom = (node, key, name, count, gymStep, gymSlot) => {
      const gym = !!gymStep;
      const possible = new Map(), classes = new Map();
      const climates = WEATHER.climateOf(node);
      for (const phase of DAYTIME.PHASES) for (const weather of [null, ...Object.keys(climates || {})]) {
        DAYTIME.force(phase.key); WEATHER.force(weather);
        const pool = gym ? Adventure.previewGymTrainers({ name: gymStep.name, ch: index }, index, gymStep)[gymSlot].pool :
          Adventure.previewPool(node, index);
        const candidates = STORY.classesOf(index, node.classes).map(cls => ({ cls,
          pool: gym || !STORY.CLASS_TYPES[cls.sprite] ? pool :
            pool.filter(mon => Game.DEX[mon.id].types.some(type => STORY.CLASS_TYPES[cls.sprite].includes(type))),
        }));
        const eligible = candidates.filter(candidate => candidate.pool.length);
        for (const { cls, pool: filtered } of eligible.length ? eligible : candidates.map(candidate => ({ ...candidate, pool }))) {
          classes.set(cls.sprite, { name: cls.name, sprite: cls.sprite });
          for (const mon of filtered) {
            const cap = Math.min(CONFIG.MAX_LEVEL, (STORY.aceOf(index) ?? CONFIG.MAX_LEVEL) + CONFIG.LEVEL_CAP_MARGIN);
            const min = Math.min(cap, mon.min + (gym ? 0 : CONFIG.TRAINER_LEVEL_BONUS[0]));
            const max = Math.min(cap, mon.max + (gym ? 0 : CONFIG.TRAINER_LEVEL_BONUS[1]));
            for (let level = min; level <= max; level++) {
              const ids = !node.lv ? [mon.id] : level >= CONFIG.TRAINER_ITEM_EVO_LEVEL ?
                Adventure.previewEvolutions(mon.id, level, index, true) :
                [mon.id, Adventure.previewEvolve(mon.id, level, true, index)];
              for (const id of ids) {
                const prior = possible.get(id);
                possible.set(id, { id, name: Game.DEX[id].name,
                  min: Math.min(prior?.min ?? level, level), max: Math.max(prior?.max ?? level, level) });
              }
            }
          }
        }
      }
      trainers.push({ key, name, location: node.name, count, random: true,
        classes: [...classes.values()], size: gym ? [1, 1] :
          [1, 1 + Math.min(2, Math.floor((index - STORY.firstChapterOf(STORY.regionOf(index).key)) / 2) + 1)],
        team: [...possible.values()].sort((a, b) => a.id - b.id) });
    };
    chapter.steps.forEach((step, stepIndex) => {
      const key = `${index}:${stepIndex}`;
      if (step.kind === 'route' && step.trainers && !chapter.league) {
        addRandom({ ...step, ch: index, lv: step.lv || STORY.routeBand(index, routes.indexOf(step), routes.length) },
          key, 'Dresseurs de route', step.trainers);
      }
      if (!['gym', 'trainer'].includes(step.kind)) return;
      if (step.kind === 'gym') {
        for (const [slot, node] of Adventure.previewGymTrainers({ name: step.name, ch: index }, index, step).entries()) {
          addRandom(node, `${key}:assistant:${slot}`, `Assistant d’arène ${slot + 1}`, 1, step, slot);
        }
      }
      const team = step.kind === 'gym' ? STORY.gymTeam(index, step) : STORY.trainerTeam(index, step);
      trainers.push({ key, name: step.leader || step.trainer,
        location: step.name, sprite: step.sprite, boss: step.boss,
        team: team.map(([id, level]) => ({ id, level, name: Game.DEX[id].name })) });
    });
    return { league: !!chapter.league, trainers };
  }));
}

if (require.main === module) {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: node tools/build_chapter_preview.cjs /chemin/app.<hash>.js');
  const source = fs.readFileSync(filename, 'utf8');
  const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 10);
  if (path.basename(filename) !== `app.${hash}.js`) throw new Error('Empreinte du bundle incorrecte.');
  const data = { bundle: path.basename(filename), chapters: extract(source) };
  fs.writeFileSync(path.join(__dirname, '../ui/chapter-data.js'),
    '// Generated by tools/build_chapter_preview.cjs. Game data belongs to its authors.\n' +
    `globalThis.PokeCatchChapterData = ${JSON.stringify(data)};\n`);
}

module.exports = { extract, loadGame };
