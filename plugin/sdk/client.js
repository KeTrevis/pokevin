// @ts-check
/**
 * @param {Set<() => void>} cleanups
 * @param {() => boolean} [active]
 * @returns {{battles: import('../types/battles').Battles, simulate: import('../types/adventures').Simulate}}
 */
globalThis.PokevinCreateSDK = function (cleanups, active = () => true) {
  function session() {
    if (!active()) throw new Error('Script arrêté.');
    const sessionId = crypto.randomUUID();
    let sequence = 0, closed = false;
    /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>}>} */
    const pending = new Map();
    /** @param {MessageEvent} event */
    function receive(event) {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'pokevin-sdk-reply' || event.data.sessionId !== sessionId) return;
      if (event.data.disconnected) { close(); return; }
      const request = pending.get(event.data.requestId);
      if (!request) return;
      pending.delete(event.data.requestId);
      clearTimeout(request.timer);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.value);
    }
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('message', receive);
      cleanups.delete(close);
      window.postMessage({ type: 'pokevin-sdk', sessionId, method: 'close' }, location.origin);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Simulation fermée.'));
      }
      pending.clear();
    }
    cleanups.add(close);
    window.addEventListener('message', receive);
    /** @param {string} method @param {object} [args] */
    function call(method, args = {}) {
      if (closed) return Promise.reject(new Error('Simulation fermée.'));
      return new Promise((resolve, reject) => {
        const requestId = ++sequence;
        const timer = setTimeout(() => { close(); }, 30000);
        pending.set(requestId, { resolve, reject, timer });
        window.postMessage({ type: 'pokevin-sdk', sessionId, requestId, method, ...args }, location.origin);
      });
    }
    return { call, close };
  }
  /** @param {string} method @param {object} args */
  async function once(method, args) {
    const connection = session();
    try { return await connection.call(method, args); } finally { connection.close(); }
  }
  /** @type {import('../types/battles').Battles} */
  const battles = {
    catalog: save => once('catalog', { save }),
    roaming: (save, chapter, now) => once('roaming', { save, chapter, now }),
    interval: (wins, runs) => once('interval', { wins, runs }),
    async prepare(save, target, options) {
      const connection = session();
      try {
        const metadata = await connection.call('prepare', { save, target, options });
        return Object.freeze({ ...metadata, fight: (/** @type {number} */ seed) => connection.call('fight', { seed }), close: connection.close });
      } catch (error) { connection.close(); throw error; }
    },
  };
  /**
   * @type {import('../types/adventures').Simulate}
   */
  const simulate = (save, target, options) => once('simulateAdventure', {save, target, options});
  return { battles: Object.freeze(battles), simulate };
};
