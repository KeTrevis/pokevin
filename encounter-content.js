// @ts-check
(() => {
  const ui = PokeCatchUI;
  /** @type {import('./types/domain').Encounter[]} */
  let catalog = [];
  let bundle = '';
  let sequence = 0;
  /** @type {chrome.runtime.Port | undefined} */
  let port;
  /** @type {chrome.runtime.Port | undefined} */
  let searchPort;
  /** @type {{ key: string; choices: import('./types/domain').Encounter[]; selected: string; save?: import('./types/domain').Save; result?: import('./types/domain').EstimateResult<import('./types/domain').GymResult>; started?: boolean; request?: number; advice: import('./types/domain').Advice } | undefined} */
  let visit;
  /** @type {number | undefined} */
  let scheduled;
  /** @type {number | undefined} */
  let interval;
  let applying = false;

  function target() {
    const panel = document.querySelector('#screen-map.active .pg-info .mp-det');
    const zone = /** @type {HTMLButtonElement | null} */ (panel?.querySelector('[data-zone]'));
    const event = /** @type {HTMLElement | null} */ (panel?.matches('[data-evt-id]') ? panel : null);
    const chapter = /** @type {HTMLButtonElement | null} */ (panel?.querySelector('[data-go]'));
    if (panel && !panel.closest('.det-out')) {
      const container = panel.querySelector('.ev-hunt:not([hidden]), .mp-in');
      if (!container) return null;
      if (zone && !zone.disabled && panel.querySelector('.mp-chips')) return { key: `zone:${zone.dataset.zone}`, container, choices: [{ id: `zone:${zone.dataset.zone}`, name: panel.querySelector('h3')?.textContent || 'Légendaire', kind: 'zone' }] };
      if (event && !panel.querySelector('.ev-hunt[hidden]')) return { key: `event:${event.dataset.evtId}`, container,
        choices: [{ id: `event:${event.dataset.evtId}`, name: panel.querySelector('h3')?.textContent || 'Événement', kind: 'event' }] };
      if (chapter && !chapter.disabled) {
        const value = chapter.dataset.go;
        const region = /** @type {HTMLElement | null} */ (document.querySelector('#map-root .rg.active[data-rg]'))?.dataset.rg;
        // League chapters are grouped by the game's native selected region.
        const choices = value === 'L' ? catalog.filter(choice => choice.kind === `league:${region || 'kanto'}`) :
          catalog.filter(choice => choice.chapter === Number(value));
        if (choices.length) return { key: `chapter:${value}:${region || ''}`, container, choices };
      }
    }
    const tower = document.querySelector('#screen-tower.active .tw-in');
    if (tower) return { key: 'tower', container: tower, choices: [{ id: 'tower', name: 'Prochain étage', kind: 'tower' }] };
    const raid = /** @type {HTMLElement | null} */ (document.querySelector('#screen-raid.active .rc-card.run [data-raid-go]'));
    const raidCard = raid?.closest('.rc-card')?.querySelector('.in');
    if (raid && raidCard) return { key: `raid:${raid.dataset.raidGo}`, container: raidCard,
      choices: [{ id: `raid:${raid.dataset.raidGo}`, name: 'Boss du raid', kind: 'raid' }] };
    return null;
  }

  function mismatch() {
    return !!bundle && ![...document.scripts].some(script => {
      try { return new URL(script.src).pathname.endsWith('/' + bundle); } catch { return false; }
    });
  }

  function cancelSearch() {
    searchPort?.disconnect(); searchPort = undefined;
    if (visit?.advice.status === 'searching') visit.advice = { status: 'idle' };
    render();
  }

  function cancel() {
    if (visit?.request) { try { port?.postMessage({ type: 'cancel' }); } catch {} }
    searchPort?.disconnect(); searchPort = undefined;
  }

  function removeCoach() {
    document.querySelectorAll('#pc-encounter-coach').forEach(element => element.closest('pc-ui-root')?.remove());
  }

  function render() {
    const current = target();
    if (!current || !visit || current.key !== visit.key) return;
    const props = { id: 'pc-encounter-coach', choices: visit.choices, selected: visit.selected,
      result: visit.result, advice: visit.advice, versionMismatch: mismatch(),
      onSelect: select, onSearch: search, onCancel: cancelSearch, onApply: apply };
    const root = current.container.querySelector('#pc-encounter-coach');
    if (root) ui.updateEncounter(root, props);
    else {
      const element = ui.mountEncounter(current.container, props);
      const chips = current.container.querySelector('.mp-chips');
      const host = element.closest('pc-ui-root');
      if (chips && host) chips.after(host);
    }
  }

  /** @param {string} id */
  function select(id) {
    if (!visit || !visit.choices.some(choice => choice.id === id)) return;
    cancel();
    visit = { key: visit.key, choices: visit.choices, selected: id, advice: { status: 'idle' } };
    update();
  }

  /** @returns {import('./types/domain').Save} */
  function snapshot() {
    const raw = localStorage.getItem('gachamon-save-v1');
    if (!raw || raw.length > 16 * 1024 * 1024) throw new Error('Sauvegarde absente ou trop volumineuse.');
    return JSON.parse(raw);
  }

  function connect() {
    const connection = chrome.runtime.connect({ name: 'encounter-coach' });
    port = connection;
    connection.onMessage.addListener(/** @param {import('./types/domain').GymReply} message */ message => {
      if (port !== connection) return;
      if (message.type === 'ready') { catalog = message.encounters; bundle = message.bundle; schedule(); return; }
      if (!visit || !('requestId' in message) || visit.request !== message.requestId) return;
      if (message.type === 'result' || message.type === 'error' || message.type === 'unavailable') {
        visit.result = message.type === 'result' ? message : { error: message.message || 'Rencontre indisponible.' };
        visit.request = undefined; render();
      }
    });
    connection.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== connection) return;
      port = undefined;
      if (visit?.request) {
        visit.result = { error: 'Calcul interrompu. Rouvre cette fiche pour réessayer.' };
        visit.request = undefined; render();
      }
    });
  }

  function search() {
    if (!visit || visit.advice.status === 'searching') return;
    const current = visit;
    try {
      const save = snapshot();
      const connection = chrome.runtime.connect({ name: 'encounter-coach' });
      searchPort = connection;
      const requestId = ++sequence;
      current.advice = { status: 'searching', teams: 0 };
      connection.onMessage.addListener(/** @param {import('./types/domain').OptimizationReply} message */ message => {
        if (searchPort !== connection || visit !== current || !('requestId' in message) || message.requestId !== requestId) return;
        if (message.type === 'optimization-progress') current.advice = { status: 'searching', stage: message.stage, teams: message.teams };
        if (message.type === 'optimization-result') {
          current.advice = { status: 'result', result: message };
          searchPort = undefined; connection.disconnect();
        }
        if (message.type === 'error') {
          current.advice = { status: 'error', message: message.message };
          searchPort = undefined; connection.disconnect();
        }
        render();
      });
      connection.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (searchPort !== connection) return;
        searchPort = undefined;
        if (visit === current) { current.advice = { status: 'error', message: 'Recherche interrompue. Réessaie.' }; render(); }
      });
      connection.postMessage({ type: 'encounter-optimize', requestId, encounterId: current.selected, save });
    } catch (error) { current.advice = { status: 'error', message: error instanceof Error ? error.message : String(error) }; }
    render();
  }

  async function apply() {
    if (!visit?.advice.result || applying) return;
    const current = visit;
    const proposal = visit.advice.result.team;
    applying = true;
    current.advice = { ...current.advice, status: 'applying' }; render();
    try {
      if (current.selected.startsWith('story:')) await PokeCatchTeams.apply(proposal, Number(current.selected.split(':')[1]));
      else await PokeCatchTeams.applyEncounter(proposal, current.selected);
      current.advice = { ...current.advice, status: 'result', applied: true };
      current.started = false; current.result = undefined; current.save = undefined;
    } catch (error) { current.advice = { ...current.advice, status: 'error', message: error instanceof Error ? error.message : String(error) }; }
    finally { applying = false; update(); }
  }

  function update() {
    if (document.hidden || applying) return;
    if (!port) { try { connect(); } catch { return; } }
    const current = target();
    if (!current) { cancel(); removeCoach(); visit = undefined; return; }
    if (visit?.key !== current.key) {
      cancel();
      removeCoach();
      visit = { ...current, selected: current.choices[0].id, advice: { status: 'idle' } };
    }
    render();
    if (visit.started || !bundle) return;
    visit.started = true;
    try {
      visit.save ||= snapshot(); visit.request = ++sequence;
      port?.postMessage({ type: 'encounter', requestId: visit.request, encounterId: visit.selected, save: visit.save });
    } catch (error) { visit.result = { error: error instanceof Error ? error.message : String(error) }; render(); }
  }

  function schedule() {
    if (scheduled || !interval) return;
    scheduled = setTimeout(() => { scheduled = undefined; update(); }, 150);
  }
  const observer = new MutationObserver(records => {
    for (const record of records) ui.disposeDetached(record.removedNodes);
    if (records.some(record => record.target instanceof Element && !record.target.closest('pc-ui-root, .pc-tooltip'))) schedule();
  });
  function start() {
    if (interval) return;
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    interval = setInterval(update, 2000); schedule();
  }
  window.addEventListener('pagehide', () => {
    cancel(); visit = undefined; const connection = port; port = undefined; connection?.disconnect();
    observer.disconnect(); clearInterval(interval); interval = undefined; clearTimeout(scheduled); scheduled = undefined;
  });
  window.addEventListener('pageshow', start);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelSearch();
    if (visit?.request) {
      try { port?.postMessage({ type: 'cancel' }); } catch {}
      visit.request = undefined; visit.started = false;
    }
  } else schedule(); });
  start();
})();
