// @ts-check
// Chromium loads these in its worker; Firefox loads the manifest's ordered scripts.
if (typeof importScripts === 'function') importScripts('engine/core.js', 'simulator.js', 'optimizer.js', 'chapter-xp.js');

const versionReady = fetch(chrome.runtime.getURL('engine/version.json')).then(response => response.json());
const RUNS = 100;

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'friend-pokedex-species') {
    respond({
      species: PokeCatchEngine.POKEDEX.map(({ id, name, num, types }) => ({ id, name, num, types })),
      regions: PokeCatchEngine.STORY.REGIONS.filter(region => region.dex)
        .map(({ key, name, dex, color }) => ({ key, name, dex, color })),
    });
  }
});

/** @param {import("./types/domain").PreparedFight} prepared */
function* estimate(prepared) {
  let wins = 0;
  for (let done = 1; done <= RUNS; done++) {
    wins += +GymSimulator.fight(prepared).won;
    yield { done, runs: RUNS };
  }
  return { wins, runs: RUNS, probability: wins / RUNS,
    interval: GymSimulator.interval(wins, RUNS), champion: prepared.champion.name,
    pendingTeam: prepared.pendingTeam, now: prepared.now };
}

chrome.runtime.onConnect.addListener(port => {
  if (!['arena-coach', 'arena-optimizer', 'chapter-xp'].includes(port.name)) return;
  /** @typedef {{ requestId: number, iterator?: Generator<import("./types/domain").Progress | import("./types/domain").OptimizationProgress, import("./types/domain").XPResult | import("./types/domain").GymResult | import("./types/domain").OptimizationResult | void, unknown> }} Job */
  /** @type {Job | null} */
  let job = null;
  /** @type {number | undefined} */
  let timer;
  const stop = () => { job?.iterator?.return(undefined); job = null; clearTimeout(timer); };
  /** @param {object} message */
  const send = message => { try { port.postMessage(message); } catch { stop(); } };
  versionReady.then(version => send({ type: 'ready', bundle: version.bundle,
    chapters: PokeCatchEngine.STORY.CHAPTERS.flatMap((chapter, index) =>
      !chapter.league && chapter.steps.some(step => step.kind === 'gym' && step.badge) ? [index] : []) }));
  port.onDisconnect.addListener(stop);
  port.onMessage.addListener(/** @param {import("./types/domain").ControlRequest} message */ async message => {
    if (message.type === 'cancel') { stop(); return; }
    if (message.type === 'ping') { send({ type: 'pong' }); return; }
    if (!('requestId' in message)) return;
    stop();
    /** @type {Job} */
    const current = { requestId: message.requestId };
    job = current;
    try {
      await versionReady;
      if (job !== current) return;
      if (!Number.isInteger(message.chapter)) throw new Error('Chapitre invalide.');
      const xp = message.type === 'xp';
      const champion = xp ? null : GymSimulator.champions(message.save).find(item => item.chapter === message.chapter);
      if (!xp && !champion) {
        send({ type: 'unavailable', requestId: current.requestId });
        stop(); return;
      }
      const optimizing = message.type === 'optimize';
      if (xp) current.iterator = ChapterXP.estimate(message.save, message.chapter);
      else if (champion) current.iterator = optimizing ? TeamOptimizer.search(message.save, champion.id) :
        estimate(GymSimulator.prepare(message.save, champion.id));
      const iterator = current.iterator;
      if (!iterator) return;
      const batch = () => {
        if (job !== current) return;
        try {
          const deadline = performance.now() + 30;
          let step;
          do { step = iterator.next(); }
          while (!step.done && performance.now() < deadline);
          if (!step.done) {
            send({ ...step.value, type: optimizing ? 'optimization-progress' : 'progress', requestId: current.requestId });
            if (job === current) timer = setTimeout(batch, 0);
          } else {
            send({ ...step.value, type: optimizing ? 'optimization-result' : 'result', requestId: current.requestId });
            stop();
          }
        } catch (error) {
          send({ type: 'error', requestId: current.requestId, message: (error instanceof Error ? error.message : String(error)) });
          stop();
        }
      };
      batch();
    } catch (error) {
      if (job === current) {
        send({ type: 'error', requestId: current.requestId, message: (error instanceof Error ? error.message : String(error)) });
        stop();
      }
    }
  });
});
