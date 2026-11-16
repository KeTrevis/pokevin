const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function build(source, mutate = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-engine-build-'));
  fs.mkdirSync(path.join(root, 'tools')); fs.mkdirSync(path.join(root, 'engine'));
  const script = path.join(root, 'tools/build_extension_engine.py');
  fs.copyFileSync(path.join(__dirname, '../tools/build_extension_engine.py'), script);
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  const bundle = path.join(root, `app.${hash.slice(0, 10)}.js`);
  fs.writeFileSync(bundle, source + (mutate ? ' ' : ''));
  return { root, hash, result: spawnSync('python3', [script, bundle, '--build', 'test-build'], { encoding: 'utf8' }) };
}
for (const namespace of ['t', 'a']) test(`engine extraction follows renamed ${namespace} modules and timer aliases`, () => {
  const source = `const timeout=host.setTimeout.bind(host),interval=host.setInterval.bind(host),frame=host.requestAnimationFrame.bind(host),perf=Object.freeze({now:host.performance.now.bind(host.performance)});${namespace}.POKEDEX=[] ,${namespace}.I18n={},${namespace}.DAYTIME={timer:interval(()=>{},1),clock:perf.now},${namespace}.Underground={},${namespace}.Events={time:()=>Date.now()},${namespace}.Sfx={}`;
  const { root, hash, result } = build(source);
  try {
    assert.equal(result.status, 0, result.stderr);
    const context = vm.createContext({ performance, setTimeout, Date, setInterval() { throw new Error('Live timer started'); } });
    vm.runInContext(fs.readFileSync(path.join(root, 'engine/core.js'), 'utf8'), context);
    const engine = context.PokeCatchEngine;
    assert.equal(engine.DAYTIME.timer, 0);
    engine.setSnapshotTime(12345); assert.equal(engine.Events.time(), 12345);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'engine/version.json'))).sha256, hash);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
for (const [name, source, mutate, error] of [
  ['a changed source hash', 'invalid', true, 'SHA-256'],
  ['missing modules', 'invalid', false, 'module namespace'],
  ['missing timer aliases', 'a.POKEDEX=[],a.I18n={},a.DAYTIME={},a.Underground={},a.Events={},a.Sfx={}', false, 'setTimeout alias'],
]) test(`engine extraction rejects ${name} without overwriting the engine`, () => {
  const { root, result } = build(source, mutate);
  try {
    assert.notEqual(result.status, 0); assert.ok(result.stderr.includes(error), result.stderr);
    assert.equal(fs.existsSync(path.join(root, 'engine/core.js')), false);
    assert.equal(fs.existsSync(path.join(root, 'engine/version.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
