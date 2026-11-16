import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'https://pokecatch-online.netlify.app/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    return import('../automation.js');
  },
});
