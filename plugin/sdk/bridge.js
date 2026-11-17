// @ts-check
// Only battle primitives cross from page scripts to the isolated extension worker.
(() => {
  /** @type {Map<string, chrome.runtime.Port>} */
  const sessions = new Map();
  /** @param {string} sessionId @param {object} reply */
  const send = (sessionId, reply) => window.postMessage({ type: 'pokevin-sdk-reply', sessionId, ...reply }, location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'pokevin-sdk') return;
    const { sessionId, requestId, method } = event.data;
    if (typeof sessionId !== 'string' || sessionId.length > 100) return;
    let port = sessions.get(sessionId);
    if (method === 'close') { sessions.delete(sessionId); port?.disconnect(); return; }
    if (!Number.isSafeInteger(requestId) || !['catalog', 'roaming', 'interval', 'prepare', 'fight'].includes(method)) return;
    try {
      if (!port) {
        if (sessions.size >= 64) throw new Error('Trop de simulations ouvertes. Ferme les combats inutilisés.');
        const connection = chrome.runtime.connect({ name: 'pokevin-sdk' });
        port = connection;
        sessions.set(sessionId, connection);
        connection.onMessage.addListener(reply => send(sessionId, reply));
        connection.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (sessions.get(sessionId) !== connection) return;
          sessions.delete(sessionId);
          send(sessionId, { disconnected: true });
        });
      }
      port.postMessage(event.data);
    } catch (error) {
      send(sessionId, { requestId, error: error instanceof Error ? error.message : String(error) });
    }
  });
  window.addEventListener('pagehide', () => {
    for (const port of sessions.values()) port.disconnect();
    sessions.clear();
  });
})();
