import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, sharedDirectory } from './server/paths.mjs';
import { startGame, gameUrl } from './server/game.mjs';

const { manifest_version, ...manifest } = JSON.parse(readFileSync(new URL('./plugin/manifest.json', import.meta.url), 'utf8'));
let game;

export default defineConfig({
  srcDir: 'plugin',
  imports: false,
  manifestVersion: 3,
  manifest,
  outDir: 'dist',
  outDirTemplate: 'extension{{modeSuffix}}',
  vite: () => ({
    // Use monaco-vim's ESM bundle and adapt its legacy Monaco imports.
    resolve: { alias: [
      { find: /^monaco-vim$/, replacement: path.join(root, 'node_modules/monaco-vim/dist/index.mjs') },
      { find: /^monaco-editor\/esm\/vs\/(.*)$/, replacement: 'monaco-editor/$1' },
    ] },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { exclude: ['monaco-editor'] },
  }),
  webExt: {
    startUrls: [gameUrl],
    chromiumProfile: path.join(sharedDirectory, 'chrome-profile'),
    keepProfileChanges: true,
  },
  hooks: {
    async 'server:created'() { game = await startGame(); },
    async 'server:closed'() { await game?.close(); },
    'build:publicAssets'(_wxt, files) {
      for (const name of ['core.js', 'version.json']) {
        files.push({ absoluteSrc: path.join(root, 'engine', name), relativeDest: `engine/${name}` });
      }
      for (const [source, destination] of [
        ['monaco-editor/LICENSE', 'monaco-LICENSE.txt'],
        ['monaco-editor/ThirdPartyNotices.txt', 'monaco-ThirdPartyNotices.txt'],
        ['dompurify/LICENSE', 'monaco-DOMPurify-LICENSE.txt'],
        ['monaco-vim/LICENSE', 'monaco-vim-LICENSE.txt'],
        ['monaco-vim/LICENSE.codemirror.txt', 'monaco-vim-CodeMirror-LICENSE.txt'],
      ]) files.push({ absoluteSrc: path.join(root, 'node_modules', source), relativeDest: `licenses/${destination}` });
      files.push({ absoluteSrc: path.join(root, 'plugin/ui/script-fonts-LICENSE.txt'), relativeDest: 'licenses/script-fonts-LICENSE.txt' });
    },
    'build:manifestGenerated'(wxt, generated) {
      // The release remains one archive usable in both Chrome and Firefox.
      if (wxt.config.command === 'build') {
        generated.background = { service_worker: 'background.js', scripts: ['background.js'] };
        generated.browser_specific_settings = manifest.browser_specific_settings;
      } else {
        const origin = wxt.config.dev.server.origin;
        generated.content_security_policy.extension_pages = generated.content_security_policy.extension_pages
          .replace("connect-src 'self'", `connect-src 'self' ${origin} ${origin.replace('http', 'ws')}`);
      }
    },
  },
});
