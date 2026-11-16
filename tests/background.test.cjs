const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function background() {
  let now = 0, connect, message, disconnect, keepAlives = [];
  const timers = new Map(), replies = [];
  let timerId = 0, closed = false;
  const ctx = vm.createContext({
    performance: { now: () => now },
    fetch: async () => ({ json: async () => ({ bundle: 'test.js' }) }),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    chrome: { runtime: {
      getURL: file => file,
      getPlatformInfo: callback => { keepAlives.push(now); callback({}); },
      onMessage: { addListener() {} },
      onConnect: { addListener: listener => { connect = listener; } },
    } },
    PokeCatchEngine: { STORY: { CHAPTERS: [] } },
    EncounterSimulator: { catalog: () => [] },
    TeamOptimizer: { search: function* () {
      try {
        while (now < 90000) { now += 1000; yield { teams: now / 1000 }; }
        return { probability: 1 };
      } finally { closed = true; }
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), ctx);
  connect({ name: 'encounter-coach', postMessage: reply => replies.push(reply),
    onMessage: { addListener: listener => { message = listener; } },
    onDisconnect: { addListener: listener => { disconnect = listener; } },
  });
  return {
    start: () => message({ type: 'encounter-optimize', requestId: 1, encounterId: 'league:kanto', save: {} }),
    cancel: () => message({ type: 'cancel' }),
    disconnect: () => disconnect(),
    batch: () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); },
    timers, replies, keepAlives, closed: () => closed,
  };
}

test('active calculations keep the background alive beyond Firefox’s idle timeout, then stop', async () => {
  const bg = background();
  await bg.start();
  while (bg.timers.size) bg.batch();
  assert.deepEqual(bg.keepAlives, [0, 20000, 40000, 60000, 80000]);
  assert.equal(bg.replies.at(-1).type, 'optimization-result');
  assert.equal(bg.closed(), true);
  assert.equal(bg.timers.size, 0);
});

for (const action of ['cancel', 'disconnect']) test(`${action} closes the calculation without leaving a keepalive timer`, async () => {
  const bg = background();
  await bg.start();
  await bg[action]();
  assert.equal(bg.closed(), true);
  assert.equal(bg.timers.size, 0);
  assert.deepEqual(bg.keepAlives, [0]);
  assert.equal(bg.replies.some(reply => reply.type === 'optimization-result'), false);
});
