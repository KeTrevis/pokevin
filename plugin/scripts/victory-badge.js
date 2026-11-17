// @ts-check
/** @param {import('../types/script-ui').ChapterView} view
 * @param {import('../types/battles').Battles} battles
 * @param {import('../types/script-ui').ChapterBadge} badge */
async function updateVictoryBadge(view, battles, badge) {
  const save = pokevin.saves.read();
  const [catalog, roamer] = await Promise.all([
    battles.catalog(save),
    getRoamer(view.chapterId, battles, save),
  ]);
  if (!isSupported(view.chapterId, catalog, roamer)) {
    badge.remove();
    return;
  }
  badge.update({ gameBundle: catalog.bundle });
  const calculation = globalThis.PokevinVictoryChance(battles, save, view.chapterId);
  let step = await calculation.next();
  while (!step.done) step = await calculation.next();
  const result = step.value;
  if (!result) return;
  const percent = (result.probability * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const state = getState(result.probability);
  badge.update({
    text: `⚔️ Victoire ${percent} %`,
    color: getColor(state),
    tooltip: `Contre ${result.champion}. Chance de victoire avec l’équipe en route à 100 % de PV.`,
    busy: false,
    data: { state, champion: result.champion },
  });
}

/** @param {import('../types/domain').XPTarget} chapterId
 * @param {import('../types/battles').Battles} battles
 * @param {import('../types/domain').Save} save */
async function getRoamer(chapterId, battles, save) {
  if (typeof chapterId !== 'number') return null;
  return battles.roaming(save, chapterId);
}

/** @param {import('../types/domain').XPTarget} chapterId
 * @param {Awaited<ReturnType<import('../types/battles').Battles['catalog']>>} catalog
 * @param {import('../types/domain').Encounter | null} roamer */
function isSupported(chapterId, catalog, roamer) {
  if (typeof chapterId === 'number') {
    if (roamer) return true;
    return catalog.champions.some(champion => champion.chapter === chapterId);
  }
  return catalog.encounters.some(encounter => encounter.id === chapterId);
}

/** @param {number} probability
 * @returns {'good' | 'poor' | 'result'} */
function getState(probability) {
  if (probability >= 0.65) return 'good';
  if (probability < 0.4) return 'poor';
  return 'result';
}

/** @param {ReturnType<typeof getState>} state */
function getColor(state) {
  if (state === 'good') return 'var(--green)';
  if (state === 'poor') return 'var(--danger-text)';
  return 'var(--caution)';
}

/** @param {unknown} error */
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

pokevin.chapters.onViewed(async (view, { ui, battles }) => {
  if (!view) return;
  if (typeof view.chapterId !== 'number' && !view.chapterId.startsWith('league:')) return;

  const badge = ui.chapterBadge(view.chapterId, {
    id: 'pc-arena-chance',
    text: '⚔️ Victoire Calcul…',
    color: 'var(--text)',
    tooltip: 'Chance de victoire avec l’équipe en route à 100 % de PV.',
    busy: true,
    data: { state: 'pending' },
  });
  try {
    await updateVictoryBadge(view, battles, badge);
  } catch (error) {
    badge.update({
      text: '⚔️ Victoire Indisponible',
      color: 'var(--text)',
      busy: false,
      tooltip: getErrorMessage(error),
      data: { state: 'error' },
    });
  }
});
