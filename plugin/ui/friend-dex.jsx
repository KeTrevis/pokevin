// @ts-check
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadFriendDex } from './friend-api.js';

/** @typedef {import('../types/domain').DexSpecies} Species */
/** @typedef {import('../types/domain').DexRegion} Region */
/** @param {string} text */
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
/** @param {import('react').SyntheticEvent<HTMLImageElement>} event */
function centerSprite({ currentTarget: image }) {
  // Like the game, center the visible sprite rather than its transparent image frame.
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return;
  try {
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] <= 10) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right >= left) image.style.translate = `${(canvas.width - left - right - 1) / 2 / canvas.width * 100}% ${(canvas.height - top - bottom - 1) / 2 / canvas.height * 100}%`;
  } catch { /* A sprite served without CORS still displays with its original framing. */ }
}
/** @param {{ uid: string, name: string, close(): void }} props */
function FriendDex({ uid, name, close }) {
  const [attempt, retry] = useState(0);
  const [query, setQuery] = useState('');
  const [state, setState] = useState(/** @type {{ loading: boolean, error?: string, species: Species[], regions: Region[], dex: number[] }} */ ({ loading: true, species: [], regions: [], dex: [] }));
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let disposed = false;
    setState({ loading: true, species: [], regions: [], dex: [] });
    Promise.all([loadFriendDex(uid, controller.signal), chrome.runtime.sendMessage({ type: 'friend-pokedex-species' })])
      .then(([dex, catalog]) => {
        const { species, regions } = /** @type {import('../types/domain').DexCatalog} */ (catalog || {});
        if (!Array.isArray(regions) || !regions.length || !Array.isArray(species) || !species.length || species.some(mon => !Number.isInteger(mon?.id) || typeof mon?.name !== 'string')) {
          throw new Error('Recharge l’extension puis la page du jeu.');
        }
        const known = new Set(species.map(mon => mon.id));
        for (const id of new Set(dex)) if (!known.has(id)) species.push({ id, name: `Pokémon #${id}`, types: [] });
        if (!disposed) setState({ loading: false, dex: [...new Set(dex)], regions, species: species.sort((a, b) => a.id - b.id) });
      })
      .catch(error => {
        if (!disposed) setState({ loading: false, species: [], regions: [], dex: [], error: controller.signal.aborted ?
          'Le chargement a pris trop de temps. Réessaie.' : error instanceof Error ? error.message : 'Connexion impossible. Réessaie.' });
      })
      .finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [uid, attempt]);
  const caught = new Set(state.dex);
  const search = fold(query.trim());
  const species = state.species.filter(mon => !search || fold(mon.name).includes(search) || String(mon.num ?? mon.id) === search.replace(/^#?0*/, ''));
  /** @type {Region[]} */
  const regions = [...state.regions, { key: 'other', name: 'Autres', dex: [0, 0], color: '#8a8a8a' }];
  /** @param {Species} mon @param {Region} area */
  const inRegion = (mon, area) => area.key === 'other' ? !state.regions.some(item => (mon.num ?? mon.id) >= item.dex[0] && (mon.num ?? mon.id) <= item.dex[1]) :
    (mon.num ?? mon.id) >= area.dex[0] && (mon.num ?? mon.id) <= area.dex[1];
  const groups = regions.map(area => ({
    ...area, mons: species.filter(mon => inRegion(mon, area)),
    total: state.species.filter(mon => mon.num === undefined && inRegion(mon, area)),
  })).filter(area => area.mons.length);

  return <>
    <header className="pc-fdex-head"><div><h2 id="pc-fdex-title">Pokédex de {name}</h2>
      {!state.loading && !state.error && <p>{state.dex.length} espèces capturées · Dernière sauvegarde en ligne</p>}</div>
      <button className="btn ghost" type="button" onClick={close} aria-label="Fermer">✕</button></header>
    {state.loading ? <p role="status">Chargement du Pokédex…</p> : state.error ?
      <div role="alert"><p>{state.error}</p><button type="button" className="btn small" onClick={() => retry(attempt + 1)}>Réessayer</button></div> : <>
        <div className="pc-fdex-tools">
          <input type="search" aria-label="Rechercher un Pokémon" placeholder="Nom ou numéro…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <p className="pc-fdex-count" role="status">{groups.reduce((sum, area) => sum + area.mons.length, 0)} résultats</p>
        {groups.length ? groups.map(area => {
          const count = area.total.filter(mon => caught.has(mon.id)).length;
          return <details key={area.key} className="dex-region pc-fdex-region" open style={/** @type {import('react').CSSProperties} */ ({ '--rc': area.color })}>
            <summary className="dex-region-head"><h3>{area.name}</h3><span className="count">{count} / {area.total.length}</span>
              <div className="progress" aria-label={`${area.name} : ${count} sur ${area.total.length}`}><div style={{ width: `${area.total.length ? count / area.total.length * 100 : 0}%` }} /></div><span className="fold" aria-hidden="true">▾</span></summary>
            <ul className="dex-grid pc-fdex-grid">{area.mons.map(mon => <li key={mon.id} className={`dex-cell ${caught.has(mon.id) ? 'caught' : 'seen lost'}`}
              aria-label={`${mon.name} · ${caught.has(mon.id) ? 'Capturé' : 'Manquant'}`}>
              <div className="sprbox"><img src={`assets/pokemon/${mon.id}.png`} crossOrigin="anonymous" loading="lazy" alt="" onLoad={centerSprite} onError={event => { event.currentTarget.hidden = true; }} /></div>
              <div className="num">N° {String(mon.num ?? mon.id).padStart(3, '0')}</div><div className="nm">{mon.name}</div>
            </li>)}</ul>
          </details>;
        }) : <p>Aucun Pokémon à afficher.</p>}

      </>}
  </>;
}

/** @param {HTMLButtonElement} button */
function openDex(button) {
  if (document.querySelector('#pc-friend-dex')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'pc-friend-dex';
  dialog.setAttribute('aria-labelledby', 'pc-fdex-title');
  document.body.append(dialog);
  const root = createRoot(dialog);
  // Keep Escape in the top dialog so the game's underlying friend card stays open.
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('close', () => { root.unmount(); dialog.remove(); if (button.isConnected) button.focus(); }, { once: true });
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  } });
  root.render(<FriendDex uid={button.dataset.pcFriendDex || ''} name={button.dataset.name || 'mon ami'} close={() => dialog.close()} />);
  dialog.showModal();
}

function addButtons() {
  // Match both name and tag: the native trainer card does not expose its player's UID.
  const friends = [...document.querySelectorAll('#screen-friends [data-fr-open]')].map(row => ({
    uid: row.getAttribute('data-fr-open') || '',
    name: row.querySelector('.t > b')?.childNodes[0]?.textContent?.trim(),
    tag: row.querySelector('.t > b .tag')?.textContent?.trim(),
  }));
  for (const card of document.querySelectorAll('.tc-modal .tc')) {
    if (!card.querySelector('.tc-portrait.ro') || card.querySelector('[data-pc-friend-dex]')) continue;
    const name = card.querySelector('.tc-name > b')?.childNodes[0]?.textContent?.trim();
    const tag = card.querySelector('.tc-name > b .tag')?.textContent?.trim();
    const friend = friends.find(item => item.name === name && item.tag === tag);
    const container = card.querySelector('.tc-name');
    if (!friend || !container) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pc-fdex-open';
    button.dataset.pcFriendDex = friend.uid;
    button.dataset.name = friend.name || 'mon ami';
    button.setAttribute('aria-label', 'Voir son Pokédex');
    button.title = 'Voir son Pokédex';
    const icon = document.createElement('img');
    icon.src = 'assets/ui/pokedex-red.png';
    icon.alt = '';
    button.append(icon);
    container.append(button);
  }
}
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('button[data-pc-friend-dex]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openDex(button);
}, true);
document.addEventListener('keydown', event => {
  if (event.target instanceof Element && event.target.matches('[data-pc-friend-dex]') && ['Enter', ' '].includes(event.key)) event.stopPropagation();
}, true);
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; addButtons(); });
}).observe(document.documentElement, { childList: true, subtree: true });
addButtons();
