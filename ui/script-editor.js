// @ts-check
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/language/typescript/monaco.contribution.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import { getJavaScriptWorker, javascriptDefaults } from 'monaco-editor/languages/features/typescript/register.js';

import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js';

// Workers run on the extension origin, so neither a CDN nor blob/eval permissions are needed.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    return new Worker(label === 'javascript' || label === 'typescript' ? 'monaco-typescript-worker.js' : 'monaco-worker.js');
  },
};
javascriptDefaults.setCompilerOptions({ allowJs: true, checkJs: true, target: 99, noEmit: true, moduleDetection: 3 });
javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
javascriptDefaults.setEagerModelSync(true);
javascriptDefaults.addExtraLib(`
interface ChapterDetail { /** Index numérique du chapitre. */ chapterId: number; }
interface BattleDetail extends ChapterDetail { /** Index du nœud terminé. */ node?: number; /** Espèce du Pokémon errant, si présent. */ roamer?: number; }
interface Pokevin {
  /** Aller à un chapitre accessible de la région affichée, ou recommencer le chapitre en cours. */
  changeChapter(chapterId: number | string): Promise<void>;
  events: {
    /** Au début d’un parcours. Renvoie une fonction de désinscription. */
    onChapterStarted(callback: (detail: ChapterDetail) => unknown): () => void;
    /** À la fin d’un chapitre. Renvoie une fonction de désinscription. */
    onChapterFinished(callback: (detail: ChapterDetail) => unknown): () => void;
    /** Après le passage d’un nœud de combat ; ne garantit ni victoire ni capture. */
    onBattleFinished(callback: (detail: BattleDetail) => unknown): () => void;
  };
  /** Arrêter les callbacks de ce script. Depuis la console, arrêter tous les scripts. */
  stop(): void;
}
declare const pokevin: Pokevin;
`, 'file:///pokevin.d.ts');

// Order and bit fields follow TypeScript's SemanticClassificationFormat.TwentyTwenty.
const semanticLegend = {
  tokenTypes: ['class', 'enum', 'interface', 'namespace', 'typeParameter', 'type', 'parameter', 'variable', 'enumMember', 'property', 'function', 'method'],
  tokenModifiers: ['declaration', 'static', 'async', 'readonly', 'defaultLibrary', 'local'],
};
monaco.languages.registerDocumentSemanticTokensProvider('javascript', {
  getLegend: () => semanticLegend,
  async provideDocumentSemanticTokens(model, _lastResultId, cancellation) {
    const version = model.getVersionId();
    const getWorker = await getJavaScriptWorker();
    const worker = /** @type {Awaited<ReturnType<typeof getWorker>> & { getSemanticTokens(fileName: string, length: number): Promise<number[]> }} */ (await getWorker(model.uri));
    const spans = await worker.getSemanticTokens(model.uri.toString(), model.getValueLength());
    if (cancellation.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version) return null;
    const data = [];
    let previousLine = 0, previousColumn = 0;
    for (let i = 0; i < spans.length; i += 3) {
      const position = model.getPositionAt(spans[i]);
      const line = position.lineNumber - 1, column = position.column - 1;
      data.push(line - previousLine, line === previousLine ? column - previousColumn : column, spans[i + 1], (spans[i + 2] >> 8) - 1, spans[i + 2] & 255);
      previousLine = line;
      previousColumn = column;
    }
    return { data: new Uint32Array(data) };
  },
  releaseDocumentSemanticTokens() {},
});
monaco.editor.defineTheme('pokevin-dark', {
  base: 'vs-dark', inherit: true, colors: {},
  rules: [
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'method', foreground: 'DCDCAA' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'property', foreground: '9CDCFE' },
    { token: 'parameter', foreground: 'D7BA7D' },
    ...['class', 'enum', 'interface', 'namespace', 'typeParameter', 'type'].map(token => ({ token, foreground: '4EC9B0' })),
  ],
});
const editor = monaco.editor.create(/** @type {HTMLElement} */ (document.getElementById('editor')), {
  model: null, theme: 'pokevin-dark', automaticLayout: true,
  'semanticHighlighting.enabled': true,
  editContext: false, minimap: {enabled:false}, fontSize:14, scrollBeyondLastLine:false, tabSize:2,
  padding:{top:16}, fixedOverflowWidgets:true, wordWrap:'on',
});
/** @param {string} id */
function element(id) { const el = document.getElementById(id); if (!el) throw new Error('Élément absent : ' + id); return el; }
const origin = new URL(location.href).searchParams.get('origin');
if (!origin || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/pokecatch-online\.netlify\.app$/.test(origin)) throw new Error('Origine du jeu invalide.');
/** @typedef {{id: string, name: string, code: string}} Script */
/** @type {Script[]} */
let scripts = [];
let selectedId = '';
/** @type {string[]} */
let runningIds = [];
/** @type {Record<string, string>} */
let runningCode = {};
let nextRequestId = 0;
/** @type {Map<number, (success: boolean) => void>} */
const runRequests = new Map();
let loading = false;
/** @type {Map<string, monaco.editor.ITextModel>} */
const models = new Map();
/** @type {Map<string, monaco.editor.ICodeEditorViewState | null>} */
const viewStates = new Map();
const nameInput = /** @type {HTMLInputElement} */ (element('script-name'));
const createButton = /** @type {HTMLButtonElement} */ (element('new-script'));
const runButton = /** @type {HTMLButtonElement} */ (element('run'));
const restartButton = /** @type {HTMLButtonElement} */ (element('restart'));
const changesDialog = /** @type {HTMLDialogElement} */ (element('changes-dialog'));
const icons = {
  restart: '<path d="M19 8a8 8 0 1 0 1 8h-3a5 5 0 1 1-1-6l-4 3h9V4z"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  delete: '<path d="M9 3h6l1 3h4v2H4V6h4zm-3 7h12l-1 11H7z"/>',
};
/** @param {HTMLButtonElement} button @param {keyof typeof icons} icon @param {string} label */
function setIcon(button, icon, label) {
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg>`;
  button.title = label;
  button.dataset.icon = icon;
  button.setAttribute('aria-label', label);
}
/** @param {string} action @param {Record<string, unknown>} [data] */
const send = (action, data = {}) => parent.postMessage({type:'pokevin-editor',action,...data},origin);
const selected = () => scripts.find(script => script.id === selectedId);
/** @param {string} id */
const needsRestart = id => runningIds.includes(id) && runningCode[id] !== (models.get(id)?.getValue() ?? scripts.find(script => script.id === id)?.code);
function renderRestart() { restartButton.hidden = !needsRestart(selectedId); }
setIcon(restartButton, 'restart', 'Relancer pour appliquer les modifications');
/** @param {string} id */
function startScript(id) {
  const script = scripts.find(item => item.id === id);
  if (!script) return Promise.resolve(false);
  const requestId = ++nextRequestId;
  const result = new Promise(/** @param {(success: boolean) => void} resolve */ resolve => runRequests.set(requestId, resolve));
  send('run', { ...script, code: models.get(id)?.getValue() ?? script.code, requestId });
  return result;
}
/** @param {string[]} ids */
async function confirmChanges(ids) {
  const changed = ids.filter(needsRestart);
  if (!changed.length) return true;
  if (changesDialog.open) return false;
  element('changes-description').textContent = changed.length === 1
    ? 'Tes modifications sont sauvegardées. Le script utilise encore la version précédente.'
    : 'Tes modifications sont sauvegardées. Certains scripts utilisent encore leur version précédente.';
  const choice = await new Promise(resolve => {
    changesDialog.onclose = () => resolve(changesDialog.returnValue);
    changesDialog.returnValue = 'cancel';
    changesDialog.showModal();
  });
  if (choice === 'restart') {
    for (const id of changed) if (!await startScript(id)) return false;
    return true;
  }
  return choice === 'continue';
}
/** @param {string} id */
async function requestSelect(id) {
  if (id !== selectedId && await confirmChanges([selectedId])) {
    selectScript(id); send('select', {id});
  }
}
function renderList() {
  const list = element('script-list');
  list.replaceChildren(...scripts.map(script => {
    const row = document.createElement('div'); row.className = 'script-row';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'script-select';
    if (script.id === selectedId) button.setAttribute('aria-current', 'page');
    const label = document.createElement('span');
    label.className = 'script-label'; label.textContent = script.name.trim() || 'Sans nom';
    button.title = label.textContent;
    button.append(label);
    button.onclick = () => { void requestSelect(script.id); };
    const actions = document.createElement('div'); actions.className = 'script-actions';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'icon-button';
    const active = runningIds.includes(script.id);
    if (active) row.classList.add('is-running');
    setIcon(toggle, active ? 'stop' : 'play', `${active ? 'Arrêter' : 'Exécuter'} ${label.textContent}`);
    toggle.onclick = () => toggleScript(script.id);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button delete-script';
    setIcon(remove, 'delete', `Supprimer ${label.textContent}`);
    remove.onclick = () => send('delete', {id:script.id});
    actions.append(toggle, remove); row.append(button, actions);
    return row;
  }));
  const active = runningIds.includes(selectedId);
  setIcon(runButton, active ? 'stop' : 'play', active ? 'Arrêter' : 'Exécuter');
  renderRestart();
}
/** @param {string} id */
function selectScript(id) {
  if (models.has(selectedId)) viewStates.set(selectedId, editor.saveViewState());
  selectedId = id;
  const script = selected();
  loading = true;
  if (script) {
    let model = models.get(id);
    if (!model) {
      model = monaco.editor.createModel(script.code, 'javascript', monaco.Uri.parse(`file:///scripts/${encodeURIComponent(id)}.js`));
      models.set(id, model);
    }
    editor.setModel(model);
    editor.restoreViewState(viewStates.get(id) ?? null);
    nameInput.value = script.name;
  } else { editor.setModel(null); nameInput.value = ''; }
  loading = false;
  nameInput.disabled = runButton.disabled = !script;
  element('empty').hidden = !!script;
  renderList();
  if (script) editor.focus();
}
function save() {
  const script = selected();
  if (!script || loading) return;
  script.code = editor.getValue();
  script.name = nameInput.value;
  send('save', script);
  renderRestart();
}
/** @param {string} id */
function toggleScript(id) {
  if (runningIds.includes(id)) { send('stop', {id}); return; }
  void startScript(id);
}
function run() { toggleScript(selectedId); }
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== origin || event.data?.type !== 'pokevin-editor') return;
  const data = event.data;
  if (data.action === 'run-result') { runRequests.get(data.requestId)?.(data.success === true); runRequests.delete(data.requestId); }
  if (data.action === 'confirm-leave' && !changesDialog.open) {
    void confirmChanges(scripts.map(script => script.id)).then(proceed => send('leave-response', {proceed}));
  }
  if (data.action === 'library' && Array.isArray(data.scripts)) {
    for (const [id, model] of models) {
      if (!data.scripts.some((/** @type {Script} */ script) => script.id === id)) {
        if (editor.getModel() === model) editor.setModel(null);
        model.dispose(); models.delete(id); viewStates.delete(id);
      }
    }
    scripts = data.scripts;
    runningIds = data.runningIds ?? [];
    runningCode = data.runningCode ?? {};
    selectScript(data.selectedId);
    createButton.disabled = false;
    element('status').textContent = data.message || '';
    element('save-status').textContent = '';
    if (data.focusName) { nameInput.focus(); nameInput.select(); }
  }
  if (data.action === 'status' && typeof data.message === 'string') {
    runningIds = data.runningIds ?? [];
    runningCode = data.runningCode ?? {};
    element('status').textContent = data.message;
    renderList();
  }
  if (data.action === 'saved') {
    element('save-status').textContent = '';
    element('save-status').removeAttribute('data-error');
  }
  if (data.action === 'save-error') {
    element('save-status').textContent = data.message;
    element('save-status').setAttribute('data-error', '');
  }
});
editor.onDidChangeModelContent(save);
nameInput.oninput = () => { save(); renderList(); };
createButton.onclick = async () => { if (await confirmChanges([selectedId])) send('create'); };
restartButton.onclick = () => { void startScript(selectedId); };
runButton.onclick = run;
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,run);
send('ready');
