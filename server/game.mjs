import { createServer } from 'vite';
import path from 'node:path';
import { root } from './paths.mjs';
import { createDevSaveScript } from './dev-save.mjs';

export const gamePort = Number(process.env.PORT || 8080);
export const gameUrl = `http://127.0.0.1:${gamePort}/`;
const cdn = 'https://pokecatch-online.pages.dev/';

export async function startGame() {
  const local = process.env.GAME_DIR;
  const boot = local ? null : await fetch(cdn + 'boot.js', { signal: AbortSignal.timeout(30000) });
  if (boot && !boot.ok) throw new Error(`boot.js : HTTP ${boot.status}`);
  const source = boot ? (await boot.text()).replaceAll(cdn, gameUrl) : null;
  const devSaveScript = createDevSaveScript();
  const server = await createServer({
    configFile: false,
    root: local ? path.resolve(local) : path.join(root, 'server'),
    server: { host: '127.0.0.1', port: gamePort, strictPort: true,
      proxy: local ? {} : Object.fromEntries(['/bundle', '/assets', '/intros'].map(prefix =>
        [prefix, { target: cdn, changeOrigin: true }])) },
    plugins: [{ name: 'pokecatch-dev-save',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{ tag: 'script', attrs: { src: '/pokevin-dev-save.js' }, injectTo: 'head-prepend' }],
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/pokevin-dev-save.js') return next();
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(devSaveScript);
        });
      },
    }, ...(source ? [{ name: 'pokecatch-boot', configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/boot.js') return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source);
      });
    } }] : [])],
  });
  await server.listen();
  console.log(`Jeu local : ${gameUrl}`);
  return server;
}
