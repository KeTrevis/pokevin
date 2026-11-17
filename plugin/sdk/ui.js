// @ts-check
import { VERSION_WARNING } from '../ui/version-warning.js';
(() => {
  /** @typedef {import('../types/script-ui').ChapterView & {container: Element, key: string}} View */
  /** @type {View | null} */
  let current = null;
  /** @type {Set<(view: import('../types/script-ui').ChapterView | null) => unknown>} */
  const listeners = new Set();
  /** @type {Set<() => void>} */
  const renders = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let scheduled;
  function selected() {
    const panel = document.querySelector('#screen-map.active .pg-info .mp-det:not(.det-out)');
    const button = /** @type {HTMLButtonElement | null | undefined} */ (panel?.querySelector('.mp-go[data-go], [data-zone]'));
    const container = panel?.querySelector('.mp-in > .mp-chips');
    if (!button || button.disabled || !container || panel?.querySelector('.ev-hunt[hidden]')) return null;
    /** @type {import('../types/domain').XPTarget} */
    let chapterId;
    if (button.dataset.zone) chapterId = `zone:${Number(button.dataset.zone)}`;
    else if (button.dataset.go === 'L') chapterId = `league:${/** @type {HTMLElement | null} */ (document.querySelector('#map-root .rg.active[data-rg]'))?.dataset.rg || 'kanto'}`;
    else if (/^\d+$/.test(button.dataset.go || '')) chapterId = Number(button.dataset.go);
    else return null;
    const roamer = /** @type {HTMLElement | null | undefined} */ (panel?.querySelector('.rm-chip[data-roam-until]'));
    const roaming = roamer && Number(roamer.dataset.roamUntil) > Date.now() ? `${roamer.querySelector('img')?.getAttribute('src')}:${roamer.dataset.roamUntil}` : '';
    return { chapterId, container, key: `${chapterId}:${roaming}` };
  }
  /** @param {(view: import('../types/script-ui').ChapterView | null) => unknown} callback */
  function notify(callback) {
    try { Promise.resolve(callback(current && { chapterId: current.chapterId })).catch(console.error); }
    catch (error) { console.error('[Pokevin]', error); }
  }
  function refresh() {
    const next = selected();
    const changed = next?.key !== current?.key;
    current = next;
    if (changed) for (const callback of [...listeners]) if (listeners.has(callback)) notify(callback);
    for (const render of renders) render();
  }
  function schedule() {
    if (scheduled !== undefined) return;
    scheduled = setTimeout(() => { scheduled = undefined; refresh(); }, 0);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  setInterval(refresh, 2000);
  document.addEventListener('visibilitychange', schedule);

  /** @param {Set<() => void>} cleanups @param {() => boolean} active @returns {import('../types/script-ui').ScriptUI} */
  globalThis.PokevinCreateUI = function (cleanups, active) {
    return {
      chapters: {
        onViewed(callback) {
          if (typeof callback !== 'function') throw new TypeError('Callback attendu.');
          if (!active()) throw new Error('Script arrêté.');
          refresh();
          /** @type {Set<() => void>} */
          const visitCleanups = new Set();
          const leave = () => {
            for (const cleanup of visitCleanups) cleanup();
            visitCleanups.clear();
          };
          const listener = (/** @type {import('../types/script-ui').ChapterView | null} */ view) => {
            leave();
            // Capture this visit's lifetime: a later visit must not reactivate old APIs.
            let open = true;
            visitCleanups.add(() => { open = false; });
            const visitActive = () => active() && open;
            return callback(view, {
              ui: PokevinCreateUI(visitCleanups, visitActive).ui,
              battles: PokevinCreateBattles(visitCleanups, visitActive),
            });
          };
          listeners.add(listener);
          const off = () => { listeners.delete(listener); leave(); cleanups.delete(off); };
          cleanups.add(off);
          notify(listener);
          return off;
        },
      },
      ui: {
        chapterBadge(chapterId, initial) {
          if (!active()) throw new Error('Script arrêté.');
          let props = initial, removed = false;
          validate(props);
          const host = document.createElement('pc-ui-root');
          const element = document.createElement('span');
          element.className = 'pc-badge'; element.dataset.tone = 'custom';
          const text = document.createElement('b'); element.append(text); host.append(element);
          const tooltip = document.createElement('div');
          tooltip.className = 'bag-tip info-tip-box ftip pc-tooltip'; tooltip.role = 'tooltip';
          tooltip.id = `pokevin-tip-${crypto.randomUUID()}`;
          function tooltipText() {
            const mismatch = props.gameBundle && ![...document.scripts].some(script => {
              try { return new URL(script.src).pathname.endsWith('/' + props.gameBundle); } catch { return false; }
            });
            return [props.tooltip, mismatch ? VERSION_WARNING : ''].filter(Boolean).join(' ');
          }
          function hide() { tooltip.remove(); }
          function show() {
            if (!tooltipText() || !element.isConnected) return;
            tooltip.textContent = tooltipText();
            document.body.append(tooltip);
            const rect = element.getBoundingClientRect();
            tooltip.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 12))}px`;
            tooltip.style.top = `${Math.max(12, rect.top - tooltip.offsetHeight - 8)}px`;
          }
          element.addEventListener('pointerenter', show);
          element.addEventListener('pointerleave', () => { if (document.activeElement !== element) hide(); });
          element.addEventListener('focus', show);
          element.addEventListener('blur', hide);
          element.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
          element.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') tooltip.isConnected ? hide() : show(); });
          window.addEventListener('scroll', hide, true);
          window.addEventListener('resize', hide);
          /** @param {import('../types/script-ui').ChapterBadgeProps} next */
          function validate(next) {
            if (typeof next.text !== 'string') throw new TypeError('Texte de badge invalide.');
            if (next.color && !CSS.supports('color', next.color)) throw new TypeError('Couleur de badge invalide.');
          }
          function render() {
            if (removed) return;
            if (current?.chapterId !== chapterId) { host.remove(); hide(); return; }
            if (host.parentElement !== current.container) { hide(); current.container.append(host); }
            if (text.textContent !== props.text) text.textContent = props.text;
            if (props.id && element.id !== props.id) element.id = props.id;
            if (element.getAttribute('aria-label') !== props.text) element.setAttribute('aria-label', props.text);
            const busy = String(!!props.busy);
            if (element.getAttribute('aria-busy') !== busy) element.setAttribute('aria-busy', busy);
            const color = props.color || 'var(--text)';
            text.style.color = color;
            element.style.background = `color-mix(in srgb, ${color} 16%, var(--panel-2))`;
            element.style.boxShadow = `inset 0 0 0 2px color-mix(in srgb, ${color} 45%, var(--panel-2))`;
            for (const key of Object.keys(element.dataset)) if (key !== 'tone' && !(key in (props.data || {}))) delete element.dataset[key];
            for (const [key, value] of Object.entries(props.data || {})) if (element.dataset[key] !== value) element.dataset[key] = value;
            element.tabIndex = tooltipText() ? 0 : -1;
            if (tooltipText()) element.setAttribute('aria-describedby', tooltip.id);
            else { element.removeAttribute('aria-describedby'); hide(); }
            if (tooltip.isConnected && tooltip.textContent !== tooltipText()) show();
          }
          function remove() {
            if (removed) return;
            removed = true; hide(); host.remove(); renders.delete(render); cleanups.delete(remove);
            window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
          }
          renders.add(render); cleanups.add(remove); refresh();
          return {
            update(patch) { if (!removed) { const next = { ...props, ...patch }; validate(next); props = next; render(); } },
            remove,
          };
        },
      },
    };
  };
})();
