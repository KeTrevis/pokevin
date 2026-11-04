// Chromium loads these in its worker; Firefox loads the manifest's ordered scripts.
if (typeof importScripts === 'function') importScripts('engine/core.js', 'simulator.js', 'optimizer.js');

const versionReady = fetch(chrome.runtime.getURL('engine/version.json')).then(response => response.json());
const RUNS = 100;

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
  if (!['arena-coach', 'arena-optimizer'].includes(port.name)) return;
  let job = null;
  let timer;
  const stop = () => { job?.iterator?.return(); job = null; clearTimeout(timer); };
  const send = message => { try { port.postMessage(message); } catch { stop(); } };
  versionReady.then(version => send({ type: 'ready', bundle: version.bundle,
    chapters: PokeCatchEngine.STORY.CHAPTERS.flatMap((chapter, index) =>
      !chapter.league && chapter.steps.some(step => step.kind === 'gym' && step.badge) ? [index] : []) }));
  port.onDisconnect.addListener(stop);
  port.onMessage.addListener(async message => {
    if (message.type === 'cancel') { stop(); return; }
    if (message.type === 'ping') { send({ type: 'pong' }); return; }
    if (!['run', 'optimize'].includes(message.type)) return;
    stop();
    const current = { requestId: message.requestId };
    job = current;
    try {
      await versionReady;
      if (job !== current) return;
      if (!Number.isInteger(message.chapter)) throw new Error('Chapitre invalide.');
      const champion = GymSimulator.champions(message.save).find(item => item.chapter === message.chapter);
      if (!champion) {
        send({ type: 'unavailable', requestId: current.requestId });
        stop(); return;
      }
      const optimizing = message.type === 'optimize';
      current.iterator = optimizing ? TeamOptimizer.search(message.save, champion.id) :
        estimate(GymSimulator.prepare(message.save, champion.id));
      const batch = () => {
        if (job !== current) return;
        try {
          const deadline = performance.now() + 30;
          let step;
          do { step = current.iterator.next(); }
          while (!step.done && performance.now() < deadline);
          if (!step.done) {
            send({ ...step.value, type: optimizing ? 'optimization-progress' : 'progress', requestId: current.requestId });
            if (job === current) timer = setTimeout(batch, 0);
          } else {
            send({ ...step.value, type: optimizing ? 'optimization-result' : 'result', requestId: current.requestId });
            stop();
          }
        } catch (error) {
          send({ type: 'error', requestId: current.requestId, message: error.message });
          stop();
        }
      };
      batch();
    } catch (error) {
      if (job === current) {
        send({ type: 'error', requestId: current.requestId, message: error.message });
        stop();
      }
    }
  });
});
