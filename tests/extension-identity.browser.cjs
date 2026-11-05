// Run with PLAYWRIGHT_MODULE and a Chrome for Testing / Chromium installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ID = 'nkbaiikgklfinliiaiikjpegelgkjife';

async function main() {
  const manifest = require('../manifest.json');
  assert.ok(manifest.key, 'A fixed public key prevents IDs based on the installation folder');
  const files = new Set(['engine/version.json', ...manifest.background.scripts,
    manifest.background.service_worker, ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css])]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevin-identity-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging'],
    });
    const session = await context.browser().newBrowserCDPSession();
    for (const version of ['0.0.1', '0.0.2']) {
      const folder = path.join(temporary, `pokevin-${version}`);
      fs.mkdirSync(folder);
      for (const file of files) {
        const target = path.join(folder, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(ROOT, file), target);
      }
      fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ ...manifest, version }));
      const [worker, { id }] = await Promise.all([
        context.waitForEvent('serviceworker'),
        session.send('Extensions.loadUnpacked', { path: folder }),
      ]);
      assert.equal(id, EXPECTED_ID, 'New versions and folders must retain the published identity');
      assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), version);
      assert.equal(await worker.evaluate(() => chrome.runtime.id), EXPECTED_ID);
    }
    assert.equal(context.serviceWorkers().filter(worker => worker.url().startsWith('chrome-extension://')).length, 1,
      'Loading a second version replaces the first worker instead of running both');
    console.log('Chrome: two versions loaded from separate folders retain one ID and one extension worker.');
  } finally {
    await context?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
