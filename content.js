(() => {
  'use strict';
  const BADGE_ID = 'pc-arena-chance';
  const { mountBadge, updateBadge, mountAdvisor, updateAdvisor, mountPreview, updatePreview, disposeDetached } = globalThis.PokeCatchUI;
  const TOOLTIP = 'Chance of defeating the Gym Leader, calculated with the current team at 100% HP.';
  const CACHE_LIMIT = 16;
  const cache = new Map();
  const lastResults = new Map();
  const percent = value => `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  let port, bundle, gymChapters, requestId = 0, active, queued, scheduled, lastRaw, save;
  let lastRun = 0, lastPing = 0, retryAt = 0, polling = null;
  let optimizationPort, optimizationId = 0, advice = { status: 'idle' };
  let applying = false;
  let versionMismatch = false;

  function renderChapterPreview() {
    if (document.hidden) return;
    const panel = document.querySelector('#screen-map.active .pg-info .ch-det');
    const button = panel?.querySelector('.mp-go[data-go]');
    const chips = panel?.querySelector('.mp-in > .mp-chips');
    const data = globalThis.PokeCatchChapterData;
    if (!chips || !data) return;
    const target = button?.dataset.go;
    const chapters = /^\d+$/.test(target || '') ? [data.chapters[Number(target)]].filter(Boolean) : [];
    const trainers = chapters.flatMap(chapter => chapter.trainers);
    const existing = panel.querySelector('#pc-chapter-preview');
    if (!button || button.disabled || !trainers.length) { existing?.closest('pc-ui-root')?.remove(); return; }
    const key = `${target}:${data.bundle}`;
    if (existing?.dataset.chapter === key) return;
    const props = { id: 'pc-chapter-preview', trainers,
      randomTrainers: chapters.reduce((sum, chapter) => sum + chapter.randomTrainers, 0),
      versionMismatch: ![...document.scripts].some(script => {
        try { return new URL(script.src).pathname.endsWith('/' + data.bundle); } catch { return false; }
      }) };
    if (existing) { updatePreview(existing, props); existing.open = false; }
    else mountPreview(chips, props);
    panel.querySelector('#pc-chapter-preview').dataset.chapter = key;
  }

  function badgeForPanel() {
    if (document.hidden) return null;
    const panel = document.querySelector('#screen-map.active .pg-info .ch-det');
    const target = panel?.querySelector('.mp-go[data-go]')?.dataset.go;
    const chips = panel?.querySelector('.mp-in > .mp-chips');
    if (!chips || !/^\d+$/.test(target || '')) return null;
    if (gymChapters && !gymChapters.has(Number(target))) {
      chips.querySelector(`#${BADGE_ID}`)?.closest('pc-ui-root')?.remove();
      chips.parentElement.querySelector('#pc-team-advisor')?.closest('pc-ui-root')?.remove();
      return null;
    }
    let badge = chips.querySelector(`#${BADGE_ID}`);
    if (!badge) {
      badge = mountBadge(chips, {
        id: BADGE_ID, icon: '⚔️', label: 'Victoire', value: 'Calcul…',
        tooltip: TOOLTIP,
      });
      const previous = lastResults.get(Number(target));
      if (previous) showResult(badge, previous);
    }
    return { badge, chips, chapter: Number(target) };
  }

  function renderAdvisor(panel = badgeForPanel()) {
    if (!panel || advice.chapter !== panel.chapter) return;
    const props = { id: 'pc-team-advisor', advice, versionMismatch, onSearch: searchTeam, onCancel: cancelSearch, onApply: applyTeam };
    const element = panel.chips.parentElement.querySelector('#pc-team-advisor');
    if (element) updateAdvisor(element, props);
    else mountAdvisor(panel.chips, props);
  }

  function cancelSearch() {
    const connection = optimizationPort;
    optimizationPort = undefined;
    connection?.disconnect();
    if (advice.status === 'searching') advice = { ...advice, status: 'idle' };
    renderAdvisor();
  }

  async function applyTeam() {
    const panel = badgeForPanel();
    if (!panel || !advice.result || applying || advice.chapter !== panel.chapter) return;
    applying = true;
    cancel();
    advice = { ...advice, status: 'applying' }; renderAdvisor(panel);
    try {
      readSave();
      await PokeCatchTeams.apply(advice.result.team, panel.chapter);
      advice = { ...advice, status: 'result', applied: true };
    } catch (error) { advice = { ...advice, status: 'error', message: error.message }; }
    finally { applying = false; renderAdvisor(); schedule(); }
  }

  function readSave() {
    const compatible = [...document.scripts].some(script => {
      try { return new URL(script.src).pathname.endsWith('/' + bundle); } catch { return false; }
    });
    if (versionMismatch !== !compatible) {
      versionMismatch = !compatible;
      renderAdvisor();
    }
    const raw = localStorage.getItem('gachamon-save-v1');
    if (!raw || raw.length > 16 * 1024 * 1024) throw new Error('Sauvegarde absente ou trop volumineuse.');
    if (raw !== lastRaw) { save = JSON.parse(raw); lastRaw = raw; }
  }

  function searchTeam() {
    const panel = badgeForPanel();
    if (!panel || advice.status === 'searching') return;
    try {
      readSave();
      const connection = chrome.runtime.connect({ name: 'arena-optimizer' });
      optimizationPort = connection;
      const id = ++optimizationId;
      advice = { chapter: panel.chapter, status: 'searching', teams: 0 };
      connection.onMessage.addListener(message => {
        if (optimizationPort !== connection || message.requestId !== id) return;
        if (badgeForPanel()?.chapter !== advice.chapter) { cancelSearch(); schedule(); return; }
        if (message.type === 'optimization-progress') advice = { ...advice, stage: message.stage, teams: message.teams };
        else if (message.type === 'optimization-result') {
          try {
            readSave();
            advice = { ...advice, status: 'result', result: message };
          } catch (error) { advice = { ...advice, status: 'error', message: error.message }; }
          optimizationPort = undefined; connection.disconnect();
        } else if (['error', 'unavailable'].includes(message.type)) {
          advice = { ...advice, status: 'error', message: message.message || 'Ce chapitre n’a pas de champion d’arène.' };
          optimizationPort = undefined; connection.disconnect();
        }
        renderAdvisor();
      });
      connection.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (optimizationPort !== connection) return;
        optimizationPort = undefined;
        advice = { ...advice, status: 'error', message: 'La recherche a été interrompue. Relance-la pour réessayer.' };
        renderAdvisor();
      });
      connection.postMessage({ type: 'optimize', requestId: id, chapter: panel.chapter, save });
    } catch (error) {
      cancelSearch();
      advice = { chapter: panel.chapter, status: 'error', message: error.message };
    }
    renderAdvisor(panel);
  }

  function paint(badge, text, state = 'pending') {
    updateBadge(badge, { value: text,
      tone: { good: 'positive', poor: 'negative', result: 'caution' }[state] || 'neutral' });
    if (badge.dataset.state !== state) badge.dataset.state = state;
    if (state === 'error') badge.setAttribute('aria-busy', 'false');
  }

  function showResult(badge, result, updating = false) {
    paint(badge, percent(result.probability),
      result.probability >= .65 ? 'good' : result.probability < .4 ? 'poor' : 'result');
    badge.dataset.champion = result.champion;
    if (badge.getAttribute('aria-busy') !== String(updating)) badge.setAttribute('aria-busy', String(updating));
  }

  function showPending(badge, chapter) {
    const previous = lastResults.get(chapter);
    if (previous) showResult(badge, previous, true);
    else {
      paint(badge, 'Calcul…');
      if (badge.getAttribute('aria-busy') !== 'true') badge.setAttribute('aria-busy', 'true');
    }
  }

  function cancel() {
    if (active) { try { port?.postMessage({ type: 'cancel' }); } catch {} }
    active = null;
  }

  function connect() {
    if (port) return;
    try {
      const connection = chrome.runtime.connect({ name: 'arena-coach' });
      port = connection;
      connection.onMessage.addListener(message => {
        if (port !== connection) return;
        if (message.type === 'ready') {
          bundle = message.bundle; gymChapters = new Set(message.chapters); schedule(); return;
        }
        if (!active || message.requestId !== active.requestId) return;
        const panel = badgeForPanel();
        if (message.type === 'result') {
          cache.set(active.key, message);
          lastResults.set(active.chapter, message);
          if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
          if (panel?.chapter === active.chapter) showResult(panel.badge, message);
          active = null;
        } else if (message.type === 'error' || message.type === 'unavailable') {
          if (panel?.chapter === active.chapter) {
            if (message.type === 'unavailable') panel.badge.closest('pc-ui-root')?.remove();
            else paint(panel.badge, 'Indisponible', 'error');
          }
          // Cache errors for this input too: a DOM redraw must not retry in a loop.
          cache.set(active.key, { error: message.message || 'Ce chapitre n’a pas de champion d’arène.' });
          active = null;
        } else if (message.type === 'progress' && panel?.chapter === active.chapter) {
          showPending(panel.badge, active.chapter);
        }
      });
      connection.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port !== connection) return;
        port = undefined; bundle = undefined; active = null;
        retryAt = Date.now() + 3000;
      });
    } catch {
      port = undefined;
      const panel = badgeForPanel();
      if (panel) paint(panel.badge, 'Recharger', 'error');
      retryAt = Date.now() + 3000;
    }
  }

  function fingerprint(chapter) {
    const ids = save.road?.length ? save.road : save.team;
    // HP, status and win counters cannot affect the fully healed starting team.
    const team = (ids || []).map(uid => {
      const mon = save.mons?.find(item => item.uid === uid);
      if (!mon) return uid;
      const { hp, status, confused, wins, caughtAt, where, ...combat } = mon;
      return combat;
    });
    // Other owned Pokémon can block an evolution, even if they stay in the PC.
    const owned = [save.mons || [], (save.pension?.mons || []).map(slot => slot.mon),
      (save.under?.slots || []).flatMap(slot => slot.mons || []),
      [save.tradeOut?.mon, save.tradeIn?.mon, ...(save.mktOut || []).map(slot => slot.mon)]]
      .map(group => group.filter(Boolean).map(mon => [mon.uid, mon.id, !!mon.shiny, mon.reg]));
    return JSON.stringify([chapter, ids, save.team, team, owned, save.keepDup, save.v, save.adv?.chapter, save.autoSwitch, save.buddy,
      Object.entries(save.buffs || {}).filter(([, buff]) => buff?.until > Date.now()),
      save.adv?.unlocked, save.adv?.badges, save.adv?.gifts,
      save.link?.side, save.link?.to, save.link?.from, save.travel?.to,
      save.adv?.event, save.adv?.zone, save.adv?.tower, save.adv?.layout]);
  }

  function update() {
    if (applying) return;
    renderChapterPreview();
    const panel = badgeForPanel();
    if (!panel) { cancel(); cancelSearch(); queued = null; return; }
    const { badge, chapter } = panel;
    if (advice.chapter !== chapter) {
      cancelSearch();
      advice = { chapter, status: 'idle' };
    }
    renderAdvisor(panel);
    if (active && active.chapter !== chapter) cancel();
    if (!port || !bundle) {
      showPending(badge, chapter);
      if (Date.now() >= retryAt) connect();
      return;
    }
    if (Date.now() - lastPing > 20000) {
      try { port.postMessage({ type: 'ping' }); lastPing = Date.now(); } catch { return; }
    }
    try {
      readSave();
      if (advice.applied && JSON.stringify(save.team) !== JSON.stringify(advice.result.team.map(mon => mon.uid))) {
        advice = { ...advice, applied: false }; renderAdvisor(panel);
      }
      const key = fingerprint(chapter);
      if (cache.has(key)) {
        if (active && active.key !== key) cancel();
        const result = cache.get(key);
        if (result.error) paint(badge, 'Indisponible', 'error');
        else { lastResults.set(chapter, result); showResult(badge, result); }
        return;
      }
      if (active?.key === key) {
        showPending(badge, chapter);
        return;
      }
      if (active) cancel();
      showPending(badge, chapter);
      // Avoid recalculating continuously while the live team earns XP every few seconds.
      if (queued?.chapter === chapter && Date.now() - lastRun < 10000) return;
      active = { requestId: ++requestId, key, chapter };
      queued = { chapter }; lastRun = Date.now();
      port.postMessage({ type: 'run', requestId, chapter, save });
    } catch (error) {
      cancel();
      paint(badge, 'Indisponible', 'error');
    }
  }

  function schedule() {
    if (polling !== null && !scheduled) scheduled = setTimeout(() => { scheduled = null; update(); }, 150);
  }
  const observer = new MutationObserver(records => {
    for (const record of records) disposeDetached(record.removedNodes);
    if (records.some(record => record.target.id === 'screen-map' ||
        record.target.id === 'map-root' || record.target.closest?.('#map-root') ||
        [...record.addedNodes].some(node => node.nodeType === 1 && (node.id === 'map-root' || node.querySelector?.('#map-root'))))) schedule();
  });
  function start() {
    if (polling !== null) return;
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    polling = setInterval(() => update(), 2000);
    queued = null; retryAt = 0; lastPing = 0;
    schedule();
  }

  function stop() {
    cancel();
    cancelSearch();
    const connection = port;
    port = undefined; bundle = undefined;
    connection?.disconnect();
    observer.disconnect();
    clearInterval(polling); polling = null;
    clearTimeout(scheduled); scheduled = null;
  }

  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) start(); });
  start();
})();
