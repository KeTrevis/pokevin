import adventureTypes from '../types/adventures.d.ts?raw';
import battleTypes from '../types/battles.d.ts?raw';
import domainTypes from '../types/domain.d.ts?raw';
import scriptUITypes from '../types/script-ui.d.ts?raw';
// @ts-check
import { initVimMode } from 'monaco-vim';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/language/typescript/monaco.contribution.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import { getJavaScriptWorker, javascriptDefaults } from 'monaco-editor/languages/features/typescript/register.js';
// Load the language-service module before semantic tokens request its worker.
import 'monaco-editor/languages/features/typescript/tsMode.js';

import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js';

// Workers stay on the extension origin, including during WXT development.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    const file = label === 'javascript' || label === 'typescript' ? 'monaco-typescript-worker.js' : 'monaco-worker.js';
    return new Worker(chrome.runtime.getURL(file));
  },
};
javascriptDefaults.setCompilerOptions({ allowJs: true, checkJs: true, target: 99, noEmit: true, moduleDetection: 3 });
javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
javascriptDefaults.setEagerModelSync(true);
javascriptDefaults.addExtraLib(domainTypes, 'file:///types/domain.d.ts');
javascriptDefaults.addExtraLib(adventureTypes, 'file:///types/adventures.d.ts');
javascriptDefaults.addExtraLib(battleTypes, 'file:///types/battles.d.ts');
javascriptDefaults.addExtraLib(scriptUITypes, 'file:///types/script-ui.d.ts');
javascriptDefaults.addExtraLib(`
interface ChapterDetail { /** Index numérique du chapitre. */ chapterId: number; }
interface BattleDetail extends ChapterDetail { /** Index du nœud terminé. */ node?: number; /** Espèce du Pokémon errant, si présent. */ roamer?: number; }
interface Pokevin {
  catalog: import("./types/script-ui").ScriptAPI["catalog"];
  ui: import("./types/script-ui").ScriptUI["ui"];
  chapters: import("./types/script-ui").ScriptUI["chapters"];
  /** Lire une copie décodée de la sauvegarde courante, sans la modifier. */
  saves: { read(): import("./types/domain").Save };
  /** Catalogue, préparation et combats indépendants ; le script choisit son calcul. */
  battles: import("./types/battles").Battles;
  simulate: import("./types/adventures").Simulate;
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
const deleteDialog = /** @type {HTMLDialogElement} */ (element('delete-dialog'));
const vimButton = /** @type {HTMLButtonElement} */ (element('vim'));
let vimEnabled = localStorage.getItem('pokevin-vim') === 'true';
/** @type {ReturnType<typeof initVimMode> | undefined} */
let vimMode;
const icons = {
  vim: '<path d="M24 11.986h-.027l-4.318-4.318 4.303-4.414V1.461l-.649-.648h-8.198l-.66.605v1.045L12.015.027V0L12 .014 11.986 0v.027l-1.29 1.291-.538-.539H2.035l-.638.692v1.885l.616.616h.72v5.31L.027 11.987H0L.014 12 0 12.014h.027l2.706 2.706v6.467l.907.523h2.322l1.857-1.904 4.166 4.166V24l.015-.014.014.014v-.028l2.51-2.509h.485c.111 0 .211-.07.25-.179l.146-.426c.028-.084.012-.172-.037-.239l1.462-1.462-.612 1.962c-.043.141.036.289.177.332.025.008.052.012.078.012h1.824c.106-.001.201-.064.243-.163l.165-.394c.025-.065.024-.138-.004-.203-.027-.065-.08-.116-.146-.142-.029-.012-.062-.019-.097-.02h-.075l.84-2.644h1.232l-1.016 3.221c-.043.141.036.289.176.332.025.008.052.012.079.012h2.002c.11 0 .207-.066.248-.17l.164-.428c.051-.138-.021-.29-.158-.341-.029-.011-.06-.017-.091-.017h-.145l1.131-3.673c.027-.082.012-.173-.039-.24l-.375-.504-.003-.005c-.051-.064-.127-.102-.209-.102h-1.436c-.071 0-.141.03-.19.081l-.4.439h-.624l-.042-.046 4.445-4.445H24L23.986 12l.014-.014zM9.838 21.139l1.579-4.509h-.501l.297-.304h1.659l-1.563 4.555h.623l-.079.258H9.838zm3.695-7.516l.15.151-.269.922-.225.226h-.969l-.181-.181.311-.871.288-.247h.895zM5.59 20.829H3.877l-.262-.15V3.091H2.379l-.1-.1V1.815l.143-.154h7.371l.213.214v1.108l-.142.173H8.785v8.688l8.807-8.688h-2.086l-.175-.188V1.805l.121-.111h7.49l.132.133v1.07L12.979 13.25h-.373c-.015-.001-.028 0-.042.001l-.02.003c-.045.01-.086.03-.119.06l-.343.295-.004.003c-.033.031-.059.069-.073.111l-.296.83-6.119 6.276zm14.768-3.952l.474-.519h1.334l.309.415-1.265 4.107h.493l-.08.209H19.84l1.124-3.564h-2.015l-1.077 3.391h.424l-.073.174h-1.605l1.107-3.548h-2.096l-1.062 3.339h.436l-.072.209H13.27l1.514-4.46H14.198l.091-.271h1.65l.519.537h.906l.491-.554h1.061l.489.535h.953z"/>',
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
setIcon(vimButton, 'vim', 'Mode Vim');
function disposeVim() {
  vimMode?.dispose();
  vimMode = undefined;
  element('vim-status').replaceChildren();
}
function updateVim() {
  disposeVim();
  vimButton.setAttribute('aria-pressed', String(vimEnabled));
  const status = element('vim-status');
  status.hidden = !vimEnabled || !editor.getModel();
  if (!status.hidden) vimMode = initVimMode(editor, status);
}
vimButton.onclick = () => {
  vimEnabled = !vimEnabled;
  localStorage.setItem('pokevin-vim', String(vimEnabled));
  updateVim();
  if (editor.getModel()) editor.focus();
};
editor.onKeyDown(event => {
  if ((event.ctrlKey || event.metaKey) && event.keyCode === monaco.KeyCode.Enter) {
    event.preventDefault();
    run();
  }
});
updateVim();
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
  list.replaceChildren();
  for (const script of scripts) {
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
    remove.onclick = () => {
      element('delete-description').textContent = `Supprimer « ${script.name.trim() || 'Sans nom'} » ? Cette action est définitive.`;
      deleteDialog.returnValue = 'cancel';
      deleteDialog.onclose = () => {
        if (deleteDialog.returnValue === 'delete') send('delete', {id:script.id});
      };
      deleteDialog.showModal();
    };
    actions.append(toggle, remove);
    row.append(button, actions);
    list.append(row);
  }
  const active = runningIds.includes(selectedId);
  setIcon(runButton, active ? 'stop' : 'play', active ? 'Arrêter' : 'Exécuter');
  renderRestart();
}
/** @param {string} id */
function selectScript(id) {
  disposeVim();
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
  updateVim();
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
        if (editor.getModel() === model) { disposeVim(); editor.setModel(null); }
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
send('ready');
