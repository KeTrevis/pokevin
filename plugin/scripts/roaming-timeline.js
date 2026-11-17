// @ts-check
/**
 * @type {Map<number, string>}
 */
const names = new Map();
/**
 * @type {string | undefined}
 */
let gameBundle;
let loading = false;
/**
 * @type {Set<Element>}
 */
const images = new Set();

function loadNames() {
  if (gameBundle || loading) return;
  loading = true;
  pokevin.catalog().then(catalog => {
    for (const mon of catalog.species) names.set(mon.id, mon.name);
    gameBundle = catalog.bundle;
  }).catch(console.error).finally(() => { loading = false; });
}

function clearImages() {
  for (const image of images) image.remove();
  images.clear();
}

/**
 * @param {import('../types/domain').Save} save
 * @param {{type?: string, roamer?: number} | undefined} node
 */
function assignedRoamer(save, node) {
  const id = node?.type === 'wild' ? node.roamer : undefined;
  // Use the assigned encounter even after the map roamer expires or moves.
  return id && Number.isSafeInteger(id) && id > 0 && !save.roam?.caught?.includes(id) ? id : undefined;
}

/**
 * @param {Element} step
 * @param {number | undefined} id
 * @param {string} warning
 */
function updateImage(step, id, warning) {
  const existing = step.querySelector('.pc-timeline-roamer');
  if (!id || !step.classList.contains('wild')) {
    existing?.remove();
    if (existing) images.delete(existing);
    return;
  }
  loadNames();
  const image = existing || document.createElement('img');
  if (!existing) image.className = 'pc-timeline-roamer';
  // Only changed attributes are written: our observer also sees these mutations.
  for (const [key, value] of Object.entries({
    'data-id': String(id), src: `assets/pokemon/${id}.png`,
    alt: names.get(id) || 'Pokémon errant', title: warning,
  })) if (image.getAttribute(key) !== value) image.setAttribute(key, value);
  images.add(image);
  if (!existing) step.append(image);
}

pokevin.ui.observe('#timeline', timelines => {
  for (const image of images) if (!image.isConnected) images.delete(image);
  let save;
  try { save = pokevin.saves.read(); }
  catch (error) { clearImages(); throw error; }
  const adv = save.adv;
  const warning = gameBundle ? pokevin.ui.versionWarning(gameBundle) : '';
  for (const timeline of timelines) {
    const steps = [...timeline.querySelectorAll('.tl-node')];
    const ordinary = adv && !adv.event && !adv.zone && !adv.tower && !adv.league && adv.nodes?.length === steps.length;
    steps.forEach((step, index) => updateImage(step, ordinary ? assignedRoamer(save, adv.nodes[index]) : undefined, warning));
  }
}, clearImages);
