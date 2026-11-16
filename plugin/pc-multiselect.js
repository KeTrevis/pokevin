// @ts-check
/* Batch PC reordering through native pointer gestures; the game owns all save writes. */
(() => {
  const selector = '#screen-team.active #pc-grid .pc-cell:not(.ug-out):not(.ghost)';
  /** @type {Map<string, {top: number, left: number}>} */
  const selected = new Map();
  /** @type {{id: number, x: number, y: number, uid: string, moved: boolean} | null} */
  let drag = null;
  /** @type {{id: number, seen: Set<string>, x: number, y: number, active: boolean} | null} */
  let stroke = null;
  /** @type {HTMLElement | null} */
  let ghost = null;
  /** @type {HTMLElement | null} */
  let target = null;
  let scrollFrame = 0;
  let pointerX = 0, pointerY = 0;
  let after = false, busy = false, cancelled = false, suppressClick = false;
  /** @type {HTMLElement | null} */
  let bar = null;
  let message = '';
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  /** @param {EventTarget | null} node */
  const cell = node => node instanceof Element ? /** @type {HTMLElement | null} */ (node.closest(selector)) : null;
  /** @param {HTMLElement} element */
  function position(element) {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + scrollY, left: rect.left + scrollX };
  }
  function paint() {
    const screen = document.querySelector('#screen-team.active');
    if (!screen) { selected.clear(); resetDrag(); }
    const filters = screen?.querySelector('.pc-sticky');
    if (filters && !bar?.isConnected) {
      bar = document.createElement('div');
      bar.className = 'pc-multi-bar';
      const status = document.createElement('span');
      status.setAttribute('role', 'status');
      const clear = document.createElement('button');
      clear.type = 'button'; clear.className = 'pc-multi-clear'; clear.textContent = 'Désélectionner';
      clear.onclick = () => { message = ''; selected.clear(); paint(); };
      bar.append(status, clear); filters.append(bar);
    }
    if (bar) {
      const label = message || (selected.size ? `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : 'Ctrl/⌘ + clic ou glisser : sélectionner');
      if (bar.firstChild && bar.firstChild.textContent !== label) bar.firstChild.textContent = label;
      const button = bar.querySelector('button');
      if (button) button.hidden = !selected.size;
      bar.dataset.busy = String(busy);
    }
    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement)) continue;
      const on = selected.has(element.dataset.uid || '');
      element.classList.toggle('pc-multi-selected', on);
      element.setAttribute('aria-pressed', String(on));
      element.setAttribute('role', 'button');
      element.tabIndex = 0;
      if (on && !drag && !busy) selected.set(element.dataset.uid || '', position(element));
    }
  }
  /** @param {HTMLElement} element */
  function toggle(element) {
    message = '';
    const uid = element.dataset.uid;
    if (!uid) return;
    if (selected.has(uid)) selected.delete(uid);
    else selected.set(uid, position(element));
    paint();
  }
  function resetDrag() {
    drag = null;
    const pointerId = stroke?.id;
    stroke = null;
    if (pointerId != null && document.body.hasPointerCapture(pointerId)) document.body.releasePointerCapture(pointerId);
    cancelAnimationFrame(scrollFrame); scrollFrame = 0;
    ghost?.remove(); ghost = null;
    target?.classList.remove('pc-multi-before', 'pc-multi-after'); target = null;
    document.body.classList.remove('pc-multi-drag', 'pc-multi-paint');
  }
  /** @param {number} x @param {number} y */
  function paintOver(x, y) {
    if (!stroke) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - stroke.x, y - stroke.y) / 8));
    // Sample the path too: fast pointer moves can cross several cards between events.
    for (let step = 1; step <= steps; step++) {
      const element = cell(document.elementFromPoint(stroke.x + (x - stroke.x) * step / steps,
        stroke.y + (y - stroke.y) * step / steps));
      const uid = element?.dataset.uid;
      if (element && uid && !stroke.seen.has(uid)) {
        stroke.seen.add(uid); toggle(element);
      }
    }
    stroke.x = x; stroke.y = y;
  }
  /** @param {PointerEvent} event */
  function point(event) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      ghost = document.createElement('div'); ghost.className = 'pc-multi-ghost';
      const source = document.querySelector(`${selector}[data-uid="${CSS.escape(drag.uid)}"] img`);
      if (source) ghost.append(source.cloneNode(true));
      const count = document.createElement('b'); count.textContent = String(selected.size); ghost.append(count);
      document.body.append(ghost); document.body.classList.add('pc-multi-drag');
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    if (ghost) ghost.style.transform = `translate(${event.clientX + 14}px,${event.clientY + 14}px)`;
    pointerX = event.clientX; pointerY = event.clientY;
    updateTarget();
  }
  function updateTarget() {
    target?.classList.remove('pc-multi-before', 'pc-multi-after');
    const hit = document.elementFromPoint(pointerX, pointerY);
    target = cell(hit);
    if (!target && hit?.closest('#pc-grid')) {
      const nearby = [...document.querySelectorAll(selector)].filter(element => !selected.has(/** @type {HTMLElement} */ (element).dataset.uid || ''));
      const distance = (/** @type {Element} */ element) => {
        const rect = element.getBoundingClientRect();
        return Math.hypot(rect.left + rect.width / 2 - pointerX, rect.top + rect.height / 2 - pointerY);
      };
      target = /** @type {HTMLElement | undefined} */ (nearby.sort((a, b) => distance(a) - distance(b))[0]) || null;
    }
    if (target && !selected.has(target.dataset.uid || '')) {
      const rect = target.getBoundingClientRect();
      after = pointerY > rect.bottom || pointerY >= rect.top && pointerX > rect.left + rect.width / 2;
      target.classList.add(after ? 'pc-multi-after' : 'pc-multi-before');
    } else target = null;
  }
  function autoScroll() {
    if (!drag?.moved && !stroke) return;
    const top = document.querySelector('#topbar')?.getBoundingClientRect().bottom || 0;
    const bottom = innerHeight;
    const dy = pointerY > bottom - 48 ? 16 : pointerY < top + 48 ? -16 : 0;
    if (dy && (!stroke || stroke.active)) {
      scrollBy(0, dy);
      if (stroke) paintOver(pointerX, pointerY);
      else updateTarget();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }
  /** @param {string} uid */
  const find = uid => /** @type {HTMLElement | null} */ (document.querySelector(`${selector}[data-uid="${CSS.escape(uid)}"]`));
  async function settle() {
    await frame(); await frame();
    document.querySelectorAll('#pc-grid .pc-cell').forEach(element => element.getAnimations().forEach(animation => animation.finish()));
  }
  /** @param {string} uid */
  async function reveal(uid) {
    let element = find(uid);
    if (element) return element;
    const grid = document.querySelector('#screen-team.active #pc-grid');
    if (!grid) throw new Error('Ouvre le PC pour déplacer la sélection.');
    // Virtualized rows may no longer have DOM nodes after the user scrolls.
    const old = selected.get(uid);
    if (old) { scrollTo(scrollX, Math.max(0, old.top - innerHeight / 2)); await settle(); }
    element = find(uid);
    for (let top = grid.getBoundingClientRect().top + scrollY; !element && top < grid.getBoundingClientRect().bottom + scrollY; top += innerHeight) {
      if (cancelled) throw new Error('Déplacement annulé.');
      scrollTo(scrollX, Math.max(0, top - innerHeight / 3)); await settle(); element = find(uid);
    }
    if (!element) throw new Error('Un Pokémon n’est plus disponible dans le PC.');
    return element;
  }
  /** @param {HTMLElement} source @param {string} type @param {number} x @param {number} y */
  function pointer(source, type, x, y) {
    source.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 739,
      pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  }
  function endNative() {
    pointer(document.body, 'pointermove', -100, -100);
    pointer(document.body, 'pointerup', -100, -100);
  }
  /** @param {string} uid @param {string} anchor @param {boolean} insertAfter */
  async function move(uid, anchor, insertAfter) {
    if (uid === anchor) return;
    await settle();
    const source = await reveal(uid), start = source.getBoundingClientRect(), original = position(source);
    pointer(source, 'pointerdown', start.left + start.width / 2, start.top + start.height / 2);
    pointer(document.body, 'pointermove', start.left + start.width / 2 + 8, start.top + start.height / 2);
    try {
      const destination = await reveal(anchor);
      if (cancelled) throw new Error('Déplacement annulé.');
      const pos = position(destination);
      const sourceBefore = original.top < pos.top - 1 || Math.abs(original.top - pos.top) < 1 && original.left < pos.left;
      const cells = [...document.querySelectorAll('#pc-grid .pc-cell')];
      const index = cells.indexOf(destination);
      const offset = insertAfter ? Number(!sourceBefore) : -Number(sourceBefore);
      const end = /** @type {HTMLElement | undefined} */ (cells[index + offset]);
      if (!end || end.dataset.uid === uid) return;
      const rect = end.getBoundingClientRect();
      // Native sorting translates neighboring cells for its drag preview.
      const transform = getComputedStyle(end).transform;
      const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform);
      const x = rect.left - matrix.m41 + rect.width / 2, y = rect.top - matrix.m42 + rect.height / 2;
      pointer(document.body, 'pointermove', x, y);
      pointer(document.body, 'pointerup', x, y);
    } finally {
      endNative();
      // Even an unchanged native drop animates its card back into place.
      await settle();
    }
  }
  /** @param {string[]} ids @param {string} anchor @param {boolean} insertAfter */
  async function reorder(ids, anchor, insertAfter) {
    busy = true; cancelled = false; message = '';
    const scroll = { x: scrollX, y: scrollY };
    document.body.classList.add('pc-multi-busy'); paint();
    try {
      for (const uid of insertAfter ? [...ids].reverse() : ids) {
        if (cancelled || !document.querySelector('#screen-team.active')) throw new Error('Déplacement annulé.');
        await move(uid, anchor, insertAfter);
      }
      const order = PokeCatchSave.parse(localStorage.getItem('gachamon-save-v1') || 'null').pcOrder || [];
      const start = order.indexOf(anchor) + (insertAfter ? 1 : -ids.length);
      if (start < 0 || !ids.every((uid, index) => order[start + index] === uid)) {
        throw new Error('Le jeu a refusé ce déplacement. Vérifie l’ordre du PC.');
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Déplacement interrompu.';
    } finally {
      endNative(); busy = false;
      document.body.classList.remove('pc-multi-busy');
      scrollTo(scroll.x, scroll.y); paint();
    }
  }
  /** @param {Event} event */
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || event.button !== 0) return;
    if (busy) { stop(event); return; }
    if (event.pointerType === 'touch') return;
    const element = cell(event.target);
    if (!element || document.querySelector('#modal-root.open, .swap-mode')) return;
    if (event.ctrlKey || event.metaKey) {
      stop(event);
      stroke = { id: event.pointerId, seen: new Set([element.dataset.uid || '']),
        x: event.clientX, y: event.clientY, active: true };
      pointerX = event.clientX; pointerY = event.clientY;
      document.body.classList.add('pc-multi-paint');
      document.body.setPointerCapture(event.pointerId);
      toggle(element); return;
    }
    if (selected.size > 1 && selected.has(element.dataset.uid || '')) {
      stop(event);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, uid: element.dataset.uid || '', moved: false };
    } else { selected.clear(); paint(); }
  }, true);
  document.addEventListener('pointermove', event => {
    if (event.isTrusted && stroke?.id === event.pointerId) {
      stop(event);
      stroke.active = event.ctrlKey || event.metaKey;
      if (stroke.active) paintOver(event.clientX, event.clientY);
      else { stroke.x = event.clientX; stroke.y = event.clientY; }
      pointerX = event.clientX; pointerY = event.clientY;
      if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
      return;
    }
    if (!event.isTrusted || !drag || drag.id !== event.pointerId) return;
    stop(event); point(event);
  }, true);
  document.addEventListener('pointerup', event => {
    if (event.isTrusted && stroke?.id === event.pointerId) {
      stop(event); resetDrag(); suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      return;
    }
    if (!event.isTrusted || !drag || drag.id !== event.pointerId) return;
    stop(event);
    const anchor = target?.dataset.uid, moved = drag.moved, insertAfter = after;
    const ids = [...selected].sort((a, b) => Math.abs(a[1].top - b[1].top) > 2 ? a[1].top - b[1].top : a[1].left - b[1].left).map(([uid]) => uid);
    resetDrag(); suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const filtered = document.querySelector('#pc-active:not([hidden]), #pc-shiny.on') || /** @type {HTMLInputElement | null} */ (document.querySelector('#pc-search'))?.value;
    if (moved && anchor) {
      if (filtered) { message = 'Retire les filtres pour réorganiser le PC.'; paint(); }
      else void reorder(ids, anchor, insertAfter);
    }
  }, true);
  document.addEventListener('pointercancel', () => resetDrag(), true);
  addEventListener('blur', () => { cancelled = true; resetDrag(); });
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (busy || suppressClick || cell(event.target) && (event.ctrlKey || event.metaKey)) { stop(event); return; }
    if (event.target instanceof Element && event.target.closest('.pc-filters, #pc-sort, #pc-active')) {
      selected.clear(); resetDrag(); paint();
    }
  }, true);
  document.addEventListener('input', event => {
    if (event.target instanceof Element && event.target.matches('#pc-search')) { selected.clear(); resetDrag(); paint(); }
  }, true);
  document.addEventListener('change', event => {
    if (event.target instanceof Element && event.target.matches('#pc-sort')) { selected.clear(); resetDrag(); paint(); }
  }, true);
  document.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (stroke) stroke.active = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') { cancelled = true; resetDrag(); selected.clear(); paint(); }
    if (busy) { stop(event); return; }
    const element = cell(event.target);
    if (element && (event.key === ' ' || event.key === 'Enter')) {
      stop(event);
      if (event.ctrlKey || event.metaKey) toggle(element);
      else element.click();
    }
  }, true);
  document.addEventListener('keyup', event => {
    if (event.isTrusted && stroke) stroke.active = event.ctrlKey || event.metaKey;
  }, true);
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }).observe(document.body, { childList: true, subtree: true });
  paint();
})();
