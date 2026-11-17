import '../engine/core.js';

export function initializeDevSave(storage, initial) {
  const key = 'gachamon-save-v1';
  const marker = 'pokevin-dev-save-v1';
  const raw = storage.getItem(key);
  if (raw && storage.getItem(marker)) return;
  const save = raw ? JSON.parse(raw) : initial;
  const compact = save?.fmt === 2;
  const mons = compact ? save.mz?.m : save?.mons;
  if (!Array.isArray(mons) || save.fmt !== undefined && !compact) {
    throw new Error('Sauvegarde de dev incompatible : aucune modification.');
  }
  const ownsDitto = mons.some(mon => (Array.isArray(mon) ? mon[1] : mon?.id) === 132) ||
    save.pension?.mons?.some(slot => slot.mon?.id === 132);
  if (!ownsDitto) {
    const mon = initial.mons.find(mon => mon.id === 132);
    mons.push(mon);
    save.dex ??= {};
    save.dex[132] ??= { caught: 1, firstAt: mon.caughtAt, regs: { kanto: 1 }, n: 1 };
    if (compact && Array.isArray(save.mz.s)) save.mz.s.push(132);
    else { save.seen ??= {}; save.seen[132] = true; }
    const order = compact ? save.mz.o : save.pcOrder;
    if (Array.isArray(order)) order.push(compact ? mons.length - 1 : mon.uid);
  }
  if (!raw) save.lastTick = Date.now();
  if (!raw || !ownsDitto) {
    if (raw) storage.setItem('pokevin-dev-save-backup', raw);
    storage.setItem(key, JSON.stringify(save));
  }
  storage.setItem(marker, 'true');
}

export function createDevSaveScript() {
  const { Game } = globalThis.PokeCatchEngine;
  const save = Game.freshState();
  save.trainer = { name: 'Pokevin dev', sprite: 'red', feats: {} };
  save.mons = [1, 4, 7, 132].map(id => Game.makeMon(id, 15, { shiny: false }));
  save.team = save.mons.slice(0, 3).map(mon => mon.uid);
  save.adv = { chapter: 0, unlocked: 0, badges: [], gifts: { starter: 1 }, kept: {}, layout: 6,
    nodes: [], node: 0, loops: [], speed: 1, paused: true, runs: 0 };
  for (const mon of save.mons) {
    save.dex[mon.id] = { caught: 1, firstAt: mon.caughtAt, regs: { kanto: 1 }, n: 1 };
    save.seen[mon.id] = true;
  }
  return `try { (${initializeDevSave.toString()})(localStorage, ${JSON.stringify(save)}); } catch (error) { console.error('[Pokevin dev]', error); }`;
}
