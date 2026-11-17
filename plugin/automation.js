// @ts-check
/* Page-world API: user scripts have the same permissions as code in the game console. */
(() => {
  /** @typedef {{chapter: number, runs?: number, node: number, nodes: {type: string, roamer?: number}[], event?: unknown, zone?: unknown, league?: unknown, tower?: unknown}} Adventure */
  /** @typedef {(detail: {chapterId: number, node?: number, roamer?: number}) => unknown} Listener */
  /** @type {Record<string, Set<Listener>>} */
  const listeners = { ChapterStarted: new Set(), ChapterFinished: new Set(), BattleFinished: new Set() };
  /** @type {Adventure | undefined} */
  let previous;
  let changing = false;
  /** @typedef {{id: string, name: string, code: string, autoStart?: boolean, bundled?: boolean}} Script */
  /** @typedef {{scripts: Script[], selectedId: string, examplesVersion?: number, exampleCode?: string, bundledCodes?: Record<string, string>}} Library */
  /** @type {Library | undefined} */
  let library;
  /** @typedef {{active: boolean, unsubscribes: Set<() => void>, id: string, code: string}} Scope */
  /** @type {Map<string, Scope>} */
  const running = new Map();
  let status = '';
  /** @type {HTMLElement | undefined} */
  let pendingNavigation;
  let resumeNavigation = false;
  /** @type {HTMLIFrameElement | undefined} */
  let editorFrame;
  const report = (/** @type {unknown} */ error) => {
    console.error('[Pokevin]', error);
    showStatus(error instanceof Error ? error.message : String(error));
  };
  /** @param {string} name @param {number} id @param {{node?: number, roamer?: number}} [detail] */
  function emit(name, id, detail = {}) {
    for (const listener of [...listeners[name]]) {
      if (!listeners[name].has(listener)) continue;
      try { Promise.resolve(listener({ chapterId: id, ...detail })).catch(report); } catch (error) { report(error); }
    }
  }
  /** @param {string} name @param {Listener} callback */
  function on(name, callback) {
    if (typeof callback !== 'function') throw new TypeError('Callback attendu.');
    listeners[name].add(callback);
    return () => { listeners[name].delete(callback); };
  }
  /** @param {Adventure | undefined} adv */
  const ordinary = adv => adv && !adv.event && !adv.zone && !adv.league && !adv.tower;
  /** @param {string} raw */
  function observe(raw) {
    try {
      const next = /** @type {{adv?: Adventure}} */ (JSON.parse(raw)).adv;
      const before = previous;
      previous = next;
      if (!ordinary(next) || !next || !ordinary(before) || !before) return;
      const finished = (next.runs || 0) > (before.runs || 0);
      const started = next.chapter !== before.chapter || finished ||
        JSON.stringify(next.nodes) !== JSON.stringify(before.nodes) || next.node < before.node;
      if (finished || !started && next.node > before.node) {
        const end = finished ? before.nodes.length : next.node;
        for (let node = before.node; node < end; node++) {
          const step = before.nodes[node];
          if (step && ['wild', 'trainer', 'gym', 'static'].includes(step.type)) {
            emit('BattleFinished', before.chapter, { node, roamer: step.roamer });
          }
        }
      }
      if (finished) emit('ChapterFinished', before.chapter);
      if (started) emit('ChapterStarted', next.chapter);
    } catch (error) { report(error); }
  }
  // Observe each native save, including several writes in one turn, after the game finishes its work.
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    setItem.call(this, key, value);
    if (this === localStorage && key === 'gachamon-save-v1') {
      const raw = String(value);
      queueMicrotask(() => observe(raw));
    }
  };
  const initial = localStorage.getItem('gachamon-save-v1');
  if (initial) observe(initial);

  /** @param {number | string} chapterId */
  async function changeChapter(chapterId) {
    if (!(typeof chapterId === 'number' || typeof chapterId === 'string' && /^\d+$/.test(chapterId)) ||
      !Number.isSafeInteger(Number(chapterId)) || Number(chapterId) < 0) throw new TypeError('Identifiant de chapitre invalide.');
    if (changing) throw new Error('Un changement de chapitre est déjà en cours.');
    if (document.querySelector('#modal-root.open, .title-fx')) throw new Error('Ferme la fenêtre du jeu avant de changer de chapitre.');
    const map = /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-screen="map"]'));
    if (!map) throw new Error('La carte du jeu est indisponible.');
    const restoreScripts = document.querySelector('#screen-pokevin-scripts.active');
    changing = true;
    try {
      map.click();
      const chapter = /** @type {HTMLElement | null} */ (document.querySelector(`#map-root [data-ch="${Number(chapterId)}"]`));
      if (!chapter) throw new Error('Chapitre introuvable dans la région affichée.');
      chapter.click();
      const action = /** @type {HTMLButtonElement | null} */ (document.querySelector(
        `#map-root [data-restart="${Number(chapterId)}"], #map-root [data-go="${Number(chapterId)}"]`));
      if (!action || action.disabled) throw new Error('Ce chapitre est verrouillé ou indisponible.');
      action.click();
    } finally { changing = false; if (restoreScripts) activateScripts(); }
  }
  /** @param {string} id */
  function stopScript(id) {
    const scope = running.get(id);
    if (!scope) return;
    scope.active = false;
    for (const off of scope.unsubscribes) off();
    running.delete(id);
  }
  /** @param {Scope} [scope] */
  function createApi(scope) {
    /** @param {string} event @param {Listener} callback */
    const subscribe = (event, callback) => {
      if (typeof callback !== 'function') throw new TypeError('Callback attendu.');
      if (scope && !scope.active) return () => {};
      // Each script owns its registration, even when callbacks share a function.
      const off = on(event, scope ? detail => callback(detail) : callback);
      const unsubscribe = () => { off(); scope?.unsubscribes.delete(unsubscribe); };
      scope?.unsubscribes.add(unsubscribe);
      return unsubscribe;
    };
    const cleanups = scope?.unsubscribes || consoleCleanups;
    return Object.freeze({
      ...PokevinCreateUI(cleanups, () => !scope || scope.active),
      ...PokevinCreateSDK(cleanups, () => !scope || scope.active),
      saves: Object.freeze({ read() {
        const raw = localStorage.getItem('gachamon-save-v1');
        if (!raw || raw.length > 16 * 1024 * 1024) throw new Error('Sauvegarde absente ou trop volumineuse.');
        return PokeCatchSave.parse(raw);
      } }),
      changeChapter,
      events: Object.freeze({
        onChapterStarted: (/** @type {Listener} */ callback) => subscribe('ChapterStarted', callback),
        onChapterFinished: (/** @type {Listener} */ callback) => subscribe('ChapterFinished', callback),
        onBattleFinished: (/** @type {Listener} */ callback) => subscribe('BattleFinished', callback),
      }),
      stop() {
        if (scope) {
          if (!scope.active) return;
          stopScript(scope.id);
          setAutoStart(scope.id, false);
        } else {
          for (const id of running.keys()) { stopScript(id); setAutoStart(id, false); }
          for (const group of Object.values(listeners)) group.clear();
          for (const cleanup of consoleCleanups) cleanup();
        }
        showStatus('Callbacks arrêtés.');
      },
    });
  }
  /** @type {Set<() => void>} */
  const consoleCleanups = new Set();
  window.addEventListener('pagehide', () => {
    for (const id of running.keys()) stopScript(id);
    for (const cleanup of consoleCleanups) cleanup();
  });
  const api = createApi();
  Object.defineProperty(window, 'pokevin', { value: api, configurable: true });

  /** @param {string} action @param {Record<string, unknown>} [data] */
  function sendEditor(action, data = {}) {
    if (editorFrame?.contentWindow) editorFrame.contentWindow.postMessage({ type: 'pokevin-editor', action, ...data }, new URL(editorFrame.src).origin);
  }
  const runtimeState = () => ({runningIds: [...running.keys()], runningCode: Object.fromEntries([...running].map(([id, scope]) => [id, scope.code]))});
  /** @param {string} message */
  function showStatus(message) {
    status = message;
    sendEditor('status', { message, ...runtimeState() });
  }
  function loadLibrary() {
    const raw = localStorage.getItem('pokevin-scripts');
    if (raw !== null) {
      const saved = /** @type {Library} */ (JSON.parse(raw));
      if (!saved || !Array.isArray(saved.scripts) || saved.scripts.some(script => !script || typeof script.id !== 'string' || !script.id || typeof script.name !== 'string' || typeof script.code !== 'string') ||
        new Set(saved.scripts.map(script => script.id)).size !== saved.scripts.length) throw new Error('La liste de scripts enregistrée est invalide.');
      library = { scripts: saved.scripts, examplesVersion: saved.examplesVersion, exampleCode: saved.exampleCode, bundledCodes: saved.bundledCodes,
        selectedId: saved.scripts.some(script => script.id === saved.selectedId) ? saved.selectedId : saved.scripts[0]?.id ?? '' };
    } else {
      const legacy = localStorage.getItem('pokevin-script');
      const scripts = legacy !== null ? [{ id: crypto.randomUUID(), name: 'Mon script', code: legacy }] : [];
      library = { scripts, selectedId: scripts[0]?.id ?? '' };
    }
    if ((library.examplesVersion || 0) < 2) {
      const example = PokevinExampleScript;
      const found = library.scripts.some(script => script.id === example.id);
      const scripts = library.scripts.map(script => {
        if (script.id !== example.id) return script;
        if (script.code === example.legacyCode || script.code === example.code)
          return { ...script, name: example.name, code: example.code, autoStart: true };
        return { ...script, autoStart: false };
      });
      if (!found) scripts.push({ id: example.id, name: example.name, code: example.code, autoStart: true });
      saveLibrary({ scripts, selectedId: library.selectedId || example.id });
    }
    for (const example of PokevinBuiltinScripts) {
      const previousCode = library.bundledCodes?.[example.id] ??
        (example.id === PokevinExampleScript.id ? library.exampleCode : undefined);
      if (previousCode === example.code && library.scripts.some(script =>
        script.id === example.id && script.bundled && script.code === example.code && script.name === example.name)) continue;
      const scripts = library.scripts.flatMap(script => {
        if (script.id !== example.id) return [script];
        const unmodified = script.code === example.code || script.code === previousCode || example.previousCodes.includes(script.code);
        const updated = { ...script, name: example.name, code: example.code, bundled: true };
        return unmodified ? [updated] : [updated, {
          id: crypto.randomUUID(), name: `${script.name.slice(0, 60)} (copie personnelle)`, code: script.code, autoStart: false,
        }];
      });
      if (!scripts.some(script => script.id === example.id)) scripts.push({
        id: example.id, name: example.name, code: example.code, bundled: true,
        autoStart: previousCode === undefined && !!example.autoStart,
      });
      saveLibrary({ ...library, scripts, bundledCodes: {...library.bundledCodes, [example.id]: example.code} });
    }
  }
  /** @param {Library} next */
  function saveLibrary(next) {
    // Commit in memory only after storage succeeds; keep the legacy draft as a backup.
    next = { ...next, bundledCodes: next.bundledCodes ?? library?.bundledCodes, examplesVersion: 4, exampleCode: PokevinExampleScript.code };
    localStorage.setItem('pokevin-scripts', JSON.stringify(next));
    library = next;
  }
  /** @param {string} id @param {boolean} enabled */
  function setAutoStart(id, enabled) {
    if (library && PokevinBuiltinScripts.some(script => script.id === id))
      saveLibrary({ ...library, scripts: library.scripts.map(script => script.id === id ? { ...script, autoStart: enabled } : script) });
  }
  /** @param {Script} script */
  function execute(script) {
    stopScript(script.id);
    const scope = { id: script.id, code: script.code, active: true, unsubscribes: new Set() };
    running.set(script.id, scope);
    try {
      const result = new Function('pokevin', '\"use strict\";\n' + script.code)(createApi(scope));
      showStatus(scope.active ? 'Script exécuté.' : 'Callbacks arrêtés.');
      Promise.resolve(result).catch(error => {
        if (scope.active) stopScript(scope.id);
        report(error);
      });
      return true;
    } catch (error) { stopScript(scope.id); report(error); return false; }
  }
  function startAutomaticScripts() {
    try {
      if (!library) loadLibrary();
      for (const script of library?.scripts ?? []) {
        if (script.bundled && script.autoStart && !running.has(script.id)) execute(script);
      }
    } catch (error) { report(error); }
  }

  function activateScripts() {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.id === 'screen-pokevin-scripts'));
    document.querySelectorAll('#side [data-screen]').forEach(button => button.classList.toggle('active', /** @type {HTMLElement} */ (button).dataset.screen === 'pokevin-scripts'));
  }
  function openScripts() {
    const screen = document.querySelector('#screen-pokevin-scripts');
    if (!screen) return;
    // Let the game leave its current screen through its native navigation first.
    if (!screen.classList.contains('active')) /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-screen="adventure"]'))?.click();
    activateScripts();
    if (editorFrame) return;
    const url = document.documentElement.getAttribute('data-pokevin-editor');
    if (!url) { report(new Error('Éditeur indisponible. Recharge la page.')); return; }
    const frame = document.createElement('iframe');
    frame.src = `${url}?origin=${encodeURIComponent(location.origin)}`;
    frame.title = 'Scripts Pokevin';
    frame.style.cssText = 'width:100%;height:calc(100dvh - var(--topbar-h,60px) - var(--nav-h,0px) - 32px);min-height:440px;border:0;display:block';
    editorFrame = frame;
    screen.append(frame);
  }
  document.addEventListener('click', event => {
    if (resumeNavigation || changing || !document.querySelector('#screen-pokevin-scripts.active')) return;
    const target = event.target instanceof Element ? event.target.closest('[data-screen]') : null;
    if (!(target instanceof HTMLElement) || target.dataset.screen === 'pokevin-scripts') return;
    if (!library?.scripts.some(script => running.has(script.id) && running.get(script.id)?.code !== script.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    pendingNavigation = target;
    sendEditor('confirm-leave');
  }, true);
  window.addEventListener('message', event => {
    if (!editorFrame || event.source !== editorFrame.contentWindow || event.origin !== new URL(editorFrame.src).origin || event.data?.type !== 'pokevin-editor') return;
    const { action, id, code, name, requestId } = event.data;
    try {
      if (action === 'ready') {
        if (!library) loadLibrary();
        sendEditor('library', { ...library, ...runtimeState(), message: status });
        return;
      }
      if (action === 'leave-response') {
        const target = pendingNavigation;
        pendingNavigation = undefined;
        if (event.data.proceed && target?.isConnected) {
          resumeNavigation = true;
          try { target.click(); } finally { resumeNavigation = false; }
        }
        return;
      }
      if (!library) return;
      if (action === 'create') {
        const script = { id: crypto.randomUUID(), name: `Script ${library.scripts.length + 1}`, code: '' };
        saveLibrary({ scripts: [...library.scripts, script], selectedId: script.id });
        sendEditor('library', { ...library, ...runtimeState(), message: status, focusName: true });
        return;
      }
      const script = library.scripts.find(item => item.id === id);
      if (!script) return;
      if (script.bundled) {
        if (action === 'select') saveLibrary({ ...library, selectedId: script.id });
        if (action === 'run') {
          setAutoStart(script.id, true);
          sendEditor('run-result', { requestId, success: execute(script) });
        }
        if (action === 'stop') { stopScript(script.id); setAutoStart(script.id, false); showStatus('Callbacks arrêtés.'); }
        return;
      }
      if (action === 'delete') {
        const index = library.scripts.indexOf(script);
        const scripts = library.scripts.filter(item => item.id !== id);
        const selectedId = library.selectedId === id ? (scripts[Math.min(index, scripts.length - 1)]?.id ?? '') : library.selectedId;
        saveLibrary({ scripts, selectedId });
        if (running.has(id)) { stopScript(id); status = 'Callbacks arrêtés.'; }
        sendEditor('library', { ...library, ...runtimeState(), message: status });
        return;
      }
      if (action === 'select') saveLibrary({ ...library, selectedId: script.id });
      if (action === 'save' || action === 'run') {
        if (typeof code !== 'string' || typeof name !== 'string' || name.length > 80) return;
        saveLibrary({ ...library, scripts: library.scripts.map(item => item.id === id ? { ...item, code, name } : item) });
        sendEditor('saved');
      }
      if (action === 'run' && typeof code === 'string') {
        setAutoStart(script.id, true);
        sendEditor('run-result', { requestId, success: execute({ ...script, code }) });
      }
      if (action === 'stop') { stopScript(script.id); setAutoStart(script.id, false); showStatus('Callbacks arrêtés.'); }


    } catch (error) {
      if (action === 'run') sendEditor('run-result', {requestId, success: false});
      sendEditor('save-error', { message: `Enregistrement impossible : ${error instanceof Error ? error.message : String(error)}` });
      report(error);
    }
  });
  function mount() {
    const tabs = document.querySelector('#tabs');
    if (!tabs || !document.querySelector('#screen-adventure') || document.querySelector('#pokevin-scripts')) return;
    const button = document.createElement('button');
    button.id = 'pokevin-scripts';
    const icon = document.createElement('span'); icon.className = 'ic';
    const image = document.createElement('img'); image.alt = '';
    // Burn Drive sprite: https://github.com/msikma/pokesprite (items/hold-item/burn-drive.png).
    image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAv0lEQVRYw+2Vuw2EMBBEKYESnF4ZpISEtHIl0AJtXXohbRitpZFGFmvuWGOSHWnER8jvYfPpOo/H4zEkhBDRR8BxXeLn1adtExEGc0XiPQ6pt4hoYCnAeauIlMDaDKDmpWGwDIj97zykMoyvA5jlIPK3wDZPqQDLYDjO7/hshkwCDM4r50VOA6NmARQiv4JNAgAeDcgzgiU4uu6yAL8FeLhyAW4JXO111ARuA5dmRBNo+klmgUd/Ss3BHo/HUzM7kTTmBuw5K2EAAAAASUVORK5CYII=';
    icon.append(image);
    const label = document.createElement('span'); label.className = 'l'; label.textContent = 'Scripts';
    button.append(icon, label);
    button.dataset.screen = 'pokevin-scripts';
    button.addEventListener('click', openScripts);
    const section = document.createElement('section');
    section.id = 'screen-pokevin-scripts';
    section.className = 'screen';
    section.setAttribute('aria-label', 'Scripts');
    document.querySelector('#screen-adventure')?.parentElement?.append(section);
    tabs.append(button);
  }
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  mount();
  startAutomaticScripts();
  window.addEventListener('pageshow', event => { if (event.persisted) startAutomaticScripts(); });
})();
