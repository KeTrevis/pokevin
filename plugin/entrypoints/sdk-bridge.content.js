import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'https://pokecatch-online.netlify.app/*'],
  runAt: 'document_start',
  main() { return import('../sdk/bridge.js'); },
});
