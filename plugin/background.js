// @ts-check
// WXT calls this after the engine modules have loaded.
globalThis.PokevinBackground = function () {
const versionReady = fetch(chrome.runtime.getURL('engine/version.json')).then(response => response.json());
let lastKeepAlive = -Infinity;

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'friend-pokedex-species') {
    respond({
      species: PokeCatchEngine.POKEDEX.map(({ id, name, num, types }) => ({ id, name, num, types })),
      regions: PokeCatchEngine.STORY.REGIONS.filter(region => region.dex)
        .map(({ key, name, dex, color }) => ({ key, name, dex, color })),
    });
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'pokevin-sdk') { PokevinBattleSDK.connect(port); return; }
  if (!['arena-coach', 'arena-optimizer', 'encounter-coach'].includes(port.name)) return;
  /** @typedef {{ requestId: number, iterator?: Generator<import("./types/domain").Progress | import("./types/domain").OptimizationProgress, import("./types/domain").GymResult | import("./types/domain").OptimizationResult | void, unknown> | AsyncGenerator<import("./types/domain").Progress, import("./types/domain").GymResult | void, unknown> }} Job */
  /** @type {Job | null} */
  let job = null;
  /** @type {number | undefined} */
  let timer;
  const stop = () => { job?.iterator?.return(undefined); job = null; clearTimeout(timer); };
  /** @param {object} message */
  const send = message => { try { port.postMessage(message); } catch { stop(); } };
  versionReady.then(version => send({ type: 'ready', bundle: version.bundle,
    encounters: EncounterSimulator.catalog(), chapters: PokeCatchEngine.STORY.CHAPTERS.flatMap((chapter, index) =>
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
      const special = message.type === 'encounter' || message.type === 'encounter-optimize';
      if (!special && (!('chapter' in message) || !Number.isInteger(message.chapter))) throw new Error('Chapitre invalide.');
      const roamer = special ? null : EncounterSimulator.roaming(message.save, 'chapter' in message ? message.chapter : -1);
      const champion = special ? null : GymSimulator.champions(message.save).find(item => item.chapter === ('chapter' in message ? message.chapter : -1));
      if (!special && !champion && !roamer) {
        send({ type: 'unavailable', requestId: current.requestId });
        stop(); return;
      }
      const optimizing = message.type === 'optimize' || message.type === 'encounter-optimize';
      if (special) {
        if (optimizing && !/^(zone|event|story|league|roaming):/.test(message.encounterId)) throw new Error('Cette rencontre utilise une équipe imposée par le jeu.');
        current.iterator = optimizing ? TeamOptimizer.search(message.save, message.encounterId) :
          PokevinVictoryChance(PokevinBattleSDK.battles, message.save, message.encounterId);
      } else if (roamer) current.iterator = optimizing ? TeamOptimizer.search(message.save, roamer.id) :
        PokevinVictoryChance(PokevinBattleSDK.battles, message.save, roamer.id);
      else if (champion) current.iterator = optimizing ? TeamOptimizer.search(message.save, champion.id) :
        PokevinVictoryChance(PokevinBattleSDK.battles, message.save, champion.id);
      const iterator = current.iterator;
      if (!iterator) return;
      const batch = async () => {
        if (job !== current) return;
        try {
          // Firefox does not reset its event-page idle timer for port messages.
          if (performance.now() - lastKeepAlive >= 20000) {
            lastKeepAlive = performance.now();
            chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; });
          }
          const deadline = performance.now() + 30;
          let step;
          do {
            step = await iterator.next();
            if (job !== current) return;
          }
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
      await batch();
    } catch (error) {
      if (job === current) {
        send({ type: 'error', requestId: current.requestId, message: (error instanceof Error ? error.message : String(error)) });
        stop();
      }
    }
  });
});

};
