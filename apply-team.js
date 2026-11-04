// @ts-check
/* Drive the native PC controls so the live state, saved teams and save stay in sync. */
(() => {
  /** @param {string} selector */
  const query = selector => /** @type {HTMLElement | null} */ (document.querySelector(selector));
  /** @returns {import("./types/domain").Save} */
  const readSave = () => {
    const raw = localStorage.getItem('gachamon-save-v1');
    if (!raw) throw new Error('Sauvegarde absente. Relance le jeu avant d’appliquer cette équipe.');
    return JSON.parse(raw);
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  const slots = () => [...document.querySelectorAll('#team-slots > .slot')].filter(slot => slot instanceof HTMLElement);
  const team = () => slots().map(slot => slot.dataset.uid).filter(Boolean);
  /** @param {unknown} a @param {unknown} b */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** @param {string} filter */
  const filterButton = filter => {
    const [kind, value] = filter.split(':');
    return query(value ? `#pc-${kind}-pop [data-v="${CSS.escape(value)}"]` : `#pc-${kind}`);
  };

  /** @param {Element | null | undefined} source @param {Element | null | undefined} target @param {boolean} [toPC] */
  async function drag(source, target, toPC = false) {
    if (!source || !target) throw new Error('Commandes du PC introuvables.');
    const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
    if (!from.width || !to.width || !to.height) throw new Error('Le PC doit être ouvert pour appliquer cette équipe.');
    /** @param {string} type @param {number} x @param {number} y */
    const event = (type, x, y) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 731, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    });
    const x = to.left + to.width / 2, y = toPC ? to.bottom - 2 : to.top + to.height / 2;
    source.dispatchEvent(event('pointerdown', from.left + from.width / 2, from.top + from.height / 2));
    document.dispatchEvent(event('pointermove', x + 10, y));
    document.dispatchEvent(event('pointermove', x, y));
    document.dispatchEvent(event('pointerup', x, y));
    await pause();
  }

  /** @param {string[]} ids */
  async function compose(ids) {
    const input = /** @type {HTMLInputElement | null} */ (query('#pc-search'));
    if (!input) throw new Error('Commandes du PC introuvables.');
    for (let index = 0; index < ids.length; index++) {
      const uid = ids[index];
      if (team()[index] === uid) continue;
      /** @type {HTMLElement | null | undefined} */
      let source = slots().find(slot => slot.dataset.uid === uid);
      if (!source) {
        const save = readSave();
        const mon = save.mons.find(mon => mon.uid === uid);
        if (!mon) throw new Error('Un Pokémon proposé n’est plus disponible. Relance la recherche.');
        input.value = String(mon.id);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const grid = query('#pc-grid');
        if (!grid) throw new Error('Commandes du PC introuvables.');
        grid.scrollIntoView({ block: 'start' });
        await pause();
        // The PC virtualizes large collections, including duplicates of the same species.
        for (let top = 0; top <= grid.scrollHeight; top += Math.max(100, innerHeight / 2)) {
          source = /** @type {HTMLElement | null} */ (grid.querySelector(`[data-uid="${CSS.escape(uid)}"]`));
          if (source) break;
          if (grid.getBoundingClientRect().bottom <= innerHeight) break;
          window.scrollBy(0, Math.max(100, innerHeight / 2));
          await pause();
        }
      }
      const destination = source?.closest('#pc-grid') && query('#team-mini.show') ?
        query('#team-mini')?.children[index] : slots()[index];
      await drag(source, destination);
      if (team()[index] !== uid) throw new Error('Le jeu a refusé un Pokémon de cette proposition. Relance la recherche.');
    }
    while (team().length > ids.length) {
      const before = team().length;
      await drag(slots()[before - 1], query('#pc-grid'), true);
      if (team().length >= before) throw new Error('Le jeu n’a pas pu retirer un Pokémon de l’équipe.');
    }
    if (!same(team(), ids)) throw new Error('La composition n’a pas pu être appliquée.');
  }

  /** @param {import("./types/domain").TeamMon[]} proposal @param {number} chapter */
  async function apply(proposal, chapter) {
    const before = readSave();
    const ids = proposal.map(mon => mon.uid);
    if (!ids.length || ids.length > 6 || new Set(ids).size !== ids.length || proposal.some(mon =>
      !before.mons.some(owned => owned.uid === mon.uid && owned.id === mon.id && !!owned.shiny === mon.shiny))) {
      throw new Error('Un Pokémon proposé a changé ou n’est plus disponible. Relance la recherche.');
    }
    if (before.adv.event || before.adv.zone || before.adv.tower) throw new Error('Reviens à l’aventure normale pour appliquer cette équipe.');
    if (same(before.team, ids)) return;
    if (!query('#tabs [data-screen="team"]') || query('#modal-root.open, .swap-mode')) {
      throw new Error('Ferme la fenêtre ouverte avant d’appliquer cette équipe.');
    }
    // Prevent a real pointer/key action from interrupting the short sequence of native moves.
    /** @param {Event} event */
    const block = event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('keydown', block, true);
    let filters, search;
    try {
      query('#tabs [data-screen="team"]')?.click();
      await pause();
      search = /** @type {HTMLInputElement | null} */ (query('#pc-search'))?.value;
      filters = ['type', 'region'].flatMap(kind =>
        [...document.querySelectorAll(`#pc-${kind}-pop [data-v].on`)].filter(button => button instanceof HTMLElement).map(button => `${kind}:${button.dataset.v}`));
      for (const kind of ['shiny', 'evo']) if (query(`#pc-${kind}.on`)) filters.push(kind);
      for (const filter of filters) filterButton(filter)?.click();
      try { await compose(ids); }
      catch (error) {
        try { await compose(before.team); }
        catch { throw new Error('Application interrompue. Vérifie ta composition dans Équipe/PC.'); }
        throw error;
      }
    } finally {
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('keydown', block, true);
      for (const filter of filters || []) {
        filterButton(filter)?.click();
      }
      const input = /** @type {HTMLInputElement | null} */ (query('#pc-search'));
      if (input && search != null) { input.value = search; input.dispatchEvent(new Event('input', { bubbles: true })); }
      query('#tabs [data-screen="map"]')?.click();
      query(`#map-root [data-ch="${chapter}"]`)?.click();
    }
  }
  /** @param {import('./types/domain').TeamMon[]} proposal @param {string} encounterId */
  async function applyEncounter(proposal, encounterId) {
    const [kind, id] = encounterId.split(':');
    if (!['zone', 'event'].includes(kind) || !/^\d+$/.test(id)) throw new Error('Rencontre invalide.');
    if (query('#evt-pick.open, #modal-root.open')) throw new Error('Ferme la fenêtre ouverte avant d’appliquer cette équipe.');
    const before = readSave(), ids = proposal.map(mon => mon.uid);
    if (!ids.length || ids.length > 6 || new Set(ids).size !== ids.length || proposal.some(mon =>
      !before.mons.some(owned => owned.uid === mon.uid && owned.id === mon.id && !!owned.shiny === mon.shiny))) {
      throw new Error('Un Pokémon proposé a changé. Relance la recherche.');
    }
    const key = kind === 'zone' ? `zone:${id}` : id;
    const original = [...(before.eventTeams[key] || [])];
    const button = query(kind === 'zone' ? `[data-lz-team="${id}"]` : `[data-evt-id="${id}"] [data-evt-edit]`);
    if (!button) throw new Error('Commandes de cette équipe introuvables.');
    button.click(); await pause();
    const input = /** @type {HTMLInputElement | null} */ (query('#evt-search'));
    const grid = query('#evt-pc');
    if (!input || !grid || !query('#evt-pick.open')) {
      query('#evt-pick [data-evt-close]')?.click();
      throw new Error('Sélecteur d’équipe introuvable.');
    }
    const names = new Map(proposal.map(mon => [mon.uid, mon.name]));
    for (const uid of original) {
      const slot = query(`#evt-team [data-uid="${CSS.escape(uid)}"]`);
      names.set(uid, slot?.getAttribute('title') || slot?.querySelector('.name')?.textContent?.trim() || '');
    }
    /** @param {HTMLElement} element */
    const tap = async element => {
      const rect = element.getBoundingClientRect();
      const options = { bubbles: true, cancelable: true, pointerId: 731, pointerType: 'mouse',
        button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1 }));
      document.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
      await pause();
    };
    /** @param {string[]} teamIds */
    const composeSpecial = async teamIds => {
      for (const uid of [...(readSave().eventTeams[key] || [])]) {
        const slot = query(`#evt-team [data-uid="${CSS.escape(uid)}"]`);
        if (!slot) throw new Error('Un emplacement est introuvable.');
        await tap(slot);
      }
      for (const uid of teamIds) {
        const mon = readSave().mons.find(mon => mon.uid === uid);
        if (!mon) throw new Error('Un Pokémon n’est plus disponible.');
        input.value = names.get(uid) || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        grid.scrollTop = 0; await pause();
        let cell;
        for (let top = 0; top <= grid.scrollHeight; top += Math.max(100, grid.clientHeight / 2)) {
          grid.scrollTop = top; await pause();
          cell = query(`#evt-pc [data-uid="${CSS.escape(uid)}"]`);
          if (cell) break;
        }
        if (!cell) throw new Error('Un Pokémon proposé n’est pas disponible dans ce sélecteur.');
        await tap(cell);
      }
      if (!same(readSave().eventTeams[key], teamIds)) throw new Error('Le jeu a refusé cette composition.');
    };
    /** @param {Event} event */
    const block = event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('keydown', block, true);
    try { await composeSpecial(ids); }
    catch (error) {
      try { await composeSpecial(original); }
      catch { throw new Error('Application interrompue. Vérifie l’équipe de cette rencontre.'); }
      throw error;
    } finally {
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('keydown', block, true);
      query('#evt-pick [data-evt-close]')?.click();
    }
  }
  globalThis.PokeCatchTeams = { apply, applyEncounter };
})();
