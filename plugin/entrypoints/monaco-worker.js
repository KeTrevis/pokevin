import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => import('monaco-editor/editor/editor.worker.js'));
