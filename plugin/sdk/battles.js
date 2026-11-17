// @ts-check
// Worker-side primitives. Prepared state stays private to its session.
(() => {
  /**
   * @returns {Promise<import('../types/battles').GameCatalog>}
   */
  async function catalog() {
    const version = await fetch(chrome.runtime.getURL('engine/version.json')).then(response => response.json());
    return { species: PokeCatchEngine.POKEDEX.map(({id, name, num, types}) => ({id, name, num, types: [...types]})), bundle: version.bundle };
  }
  /** @type {import('../types/battles').Battles} */
  const battles = {
    async catalog(save) {
      return { ...await catalog(), champions: GymSimulator.champions(save), encounters: EncounterSimulator.catalog() };
    },
    async roaming(save, chapter, now) { return EncounterSimulator.roaming(save, chapter, now); },
    async prepare(save, target, options = {}) {
      if (typeof target === 'number') {
        if (!Number.isInteger(target)) throw new Error('Chapitre invalide.');
        target = EncounterSimulator.roaming(save, target, options.now)?.id ||
          GymSimulator.champions(save).find(champion => champion.chapter === target)?.id || '';
      }
      if (typeof target !== 'string' || !target) throw new Error('Combat introuvable.');
      const simulator = /^\d+:\d+$/.test(target) ? GymSimulator : EncounterSimulator;
      const prepared = simulator.prepare(save, target, options.now, options.teamIds);
      let closed = false;
      return {
        champion: structuredClone(prepared.champion), team: structuredClone(prepared.team),
        pendingTeam: prepared.pendingTeam, now: prepared.now,
        async fight(seed) {
          if (closed) throw new Error('Simulation fermée.');
          if (seed !== undefined && !Number.isSafeInteger(seed)) throw new Error('Graine invalide.');
          return simulator.fight(prepared, null, seed);
        },
        close() { closed = true; },
      };
    },
    async interval(wins, runs) {
      if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(wins) || wins < 0 || wins > runs)
        throw new Error('Nombre de victoires ou d’essais invalide.');
      return GymSimulator.interval(wins, runs);
    },
  };

  /** @param {chrome.runtime.Port} port */
  function connect(port) {
    /** @type {import('../types/battles').Battle | undefined} */
    let battle;
    let disconnected = false;
    let lastKeepAlive = -Infinity;
    // Serialize calls so closing/replacing a session cannot leak prepared state.
    let queue = Promise.resolve();
    port.onDisconnect.addListener(() => { disconnected = true; battle?.close(); });
    /** @param {object} reply */
    function send(reply) {
      if (disconnected) return;
      try { port.postMessage(reply); } catch { disconnected = true; battle?.close(); }
    }
    port.onMessage.addListener(message => {
      queue = queue.then(async () => {
        if (disconnected) return;
        try {
          if (performance.now() - lastKeepAlive >= 20000) {
            lastKeepAlive = performance.now();
            chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; });
          }
          let value;
          switch (message.method) {
            case 'speciesCatalog': value = await catalog(); break;
            case 'catalog': value = await battles.catalog(message.save); break;
            case 'roaming': value = await battles.roaming(message.save, message.chapter, message.now); break;
            case 'interval': value = await battles.interval(message.wins, message.runs); break;
            case 'prepare': {
              battle?.close();
              battle = await battles.prepare(message.save, message.target, message.options);
              if (disconnected) { battle.close(); return; }
              const { champion, team, pendingTeam, now } = battle;
              value = { champion, team, pendingTeam, now };
              break;
            }
            case 'simulateAdventure': {
              if (message.options != null && typeof message.options !== 'object' ||
                  message.options?.now !== undefined && !Number.isFinite(message.options.now)) throw new Error('Options de simulation invalides.');
              const iterator = PokevinAdventureSDK.simulate(message.save, message.target, message.options?.now);
              try {
                let step;
                do {
                  if (disconnected) return;
                  step = iterator.next();
                  if (!step.done) await new Promise(resolve => setTimeout(resolve, 0));
                } while (!step.done);
                value = step.value;
              } finally { iterator.return(/** @type {any} */ (undefined)); }
              break;
            }
            case 'fight':
              if (!battle) throw new Error('Prépare un combat avant de le simuler.');
              value = await battle.fight(message.seed);
              break;
            default: throw new Error('Opération SDK inconnue.');
          }
          send({ requestId: message.requestId, value });
        } catch (error) {
          send({ requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
        }
      });
    });
  }
  globalThis.PokevinBattleSDK = { battles, connect };
})();
