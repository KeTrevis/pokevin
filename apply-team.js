/* Drive the native PC controls so the live state, saved teams and save stay in sync. */
(() => {
  const query = selector => document.querySelector(selector);
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  const slots = () => [...document.querySelectorAll('#team-slots > .slot')];
  const team = () => slots().map(slot => slot.dataset.uid).filter(Boolean);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const filterButton = filter => {
    const [kind, value] = filter.split(':');
    return query(value ? `#pc-${kind}-pop [data-v="${CSS.escape(value)}"]` : `#pc-${kind}`);
  };

  async function drag(source, target, toPC = false) {
    if (!source || !target) throw new Error('Commandes du PC introuvables.');
    const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
    if (!from.width || !to.width || !to.height) throw new Error('Le PC doit être ouvert pour appliquer cette équipe.');
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

  async function compose(ids) {
    const input = query('#pc-search');
    for (let index = 0; index < ids.length; index++) {
      const uid = ids[index];
      if (team()[index] === uid) continue;
      let source = slots().find(slot => slot.dataset.uid === uid);
      if (!source) {
        const save = JSON.parse(localStorage.getItem('gachamon-save-v1'));
        const mon = save.mons.find(mon => mon.uid === uid);
        if (!mon) throw new Error('Un Pokémon proposé n’est plus disponible. Relance la recherche.');
        input.value = String(mon.id);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const grid = query('#pc-grid');
        grid.scrollIntoView({ block: 'start' });
        await pause();
        // The PC virtualizes large collections, including duplicates of the same species.
        for (let top = 0; top <= grid.scrollHeight; top += Math.max(100, innerHeight / 2)) {
          source = grid.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
          if (source) break;
          if (grid.getBoundingClientRect().bottom <= innerHeight) break;
          window.scrollBy(0, Math.max(100, innerHeight / 2));
          await pause();
        }
      }
      const destination = source?.closest('#pc-grid') && query('#team-mini.show') ?
        query('#team-mini').children[index] : slots()[index];
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

  async function apply(proposal, chapter) {
    const before = JSON.parse(localStorage.getItem('gachamon-save-v1'));
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
    const block = event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('keydown', block, true);
    let filters, search;
    try {
      query('#tabs [data-screen="team"]').click();
      await pause();
      search = query('#pc-search')?.value;
      filters = ['type', 'region'].flatMap(kind =>
        [...document.querySelectorAll(`#pc-${kind}-pop [data-v].on`)].map(button => `${kind}:${button.dataset.v}`));
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
      const input = query('#pc-search');
      if (input && search != null) { input.value = search; input.dispatchEvent(new Event('input', { bubbles: true })); }
      query('#tabs [data-screen="map"]')?.click();
      query(`#map-root [data-ch="${chapter}"]`)?.click();
    }
  }
  globalThis.PokeCatchTeams = { apply };
})();
