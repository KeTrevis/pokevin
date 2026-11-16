import { defineContentScript } from 'wxt/utils/define-content-script';
import '../ui/badge.css';
import '../ui/tooltip.css';
import '../ui/advisor.css';
import '../ui/chapter-preview.css';
import '../ui/friend-dex.css';
import '../ui/pension.css';
import '../ui/pc-multiselect.css';

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'https://pokecatch-online.netlify.app/*'],
  runAt: 'document_idle',
  async main() {
    await import('../editor-loader.js');
    await import('../ui/chapter-data.js');
    await import('../ui/index.jsx');
    await import('../save-reader.js');
    await import('../apply-team.js');
    await import('../pc-multiselect.js');
    await import('../content.js');
    await import('../encounter-content.js');
  },
});
