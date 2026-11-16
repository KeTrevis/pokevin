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
  /** @typedef {{id: string, name: string, code: string}} Script */
  /** @typedef {{scripts: Script[], selectedId: string}} Library */
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
    return Object.freeze({
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
        } else {
          for (const id of running.keys()) stopScript(id);
          for (const group of Object.values(listeners)) group.clear();
        }
        showStatus('Callbacks arrêtés.');
      },
    });
  }
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
      library = { scripts: saved.scripts, selectedId: saved.scripts.some(script => script.id === saved.selectedId) ? saved.selectedId : saved.scripts[0]?.id ?? '' };
    } else {
      const legacy = localStorage.getItem('pokevin-script');
      const scripts = legacy !== null ? [{ id: crypto.randomUUID(), name: 'Mon script', code: legacy }] : [];
      saveLibrary({ scripts, selectedId: scripts[0]?.id ?? '' });
    }
  }
  /** @param {Library} next */
  function saveLibrary(next) {
    // Commit in memory only after storage succeeds; keep the legacy draft as a backup.
    localStorage.setItem('pokevin-scripts', JSON.stringify(next));
    library = next;
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
        stopScript(script.id);
        const scope = { id: script.id, code, active: true, unsubscribes: new Set() };
        running.set(script.id, scope);
        try {
          const result = new Function('pokevin', '\"use strict\";\n' + code)(createApi(scope));
          showStatus(scope.active ? 'Script exécuté.' : 'Callbacks arrêtés.');
          Promise.resolve(result).catch(error => {
            if (scope.active) stopScript(scope.id);
            report(error);
          });
          sendEditor('run-result', {requestId, success: true});
        } catch (error) { stopScript(scope.id); report(error); sendEditor('run-result', {requestId, success: false}); }
      }
      if (action === 'stop') { stopScript(script.id); showStatus('Callbacks arrêtés.'); }

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
})();
