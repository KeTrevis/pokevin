import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'https://pokecatch-online.netlify.app/*'],
  world: 'MAIN',
  runAt: 'document_start',
  async main() {
    await import('../save-reader.js');
    await import('../sdk/client.js');
    await import('../sdk/ui.js');
    await import('../scripts/victory-chance-example.js');
    return import('../automation.js');
  },
});
