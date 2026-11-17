// @ts-check
// Built-in feature: chapter policy, sampling and formatting live outside the SDK.
pokevin.chapters.onViewed(async (view, {ui, battles, simulate}) => {
  if (!view) return;
  const badge = ui.chapterBadge(view.chapterId, {
    id: 'pc-chapter-xp', text: 'XP/h Calcul…', color: 'var(--text)',
    tooltip: 'Calcul…', busy: true,
  });
  try {
    const save = pokevin.saves.read();
    const catalog = await battles.catalog(save);
    badge.update({gameBundle: catalog.bundle});
    const calculation = PokevinChapterXP(simulate, save, view.chapterId);
    let step;
    do { step = await calculation.next(); } while (!step.done);
    const result = step.value;
    badge.update({
      text: `XP/h ≈ ${Math.round(result.xpPerHour).toLocaleString('fr-FR')}`,
      color: 'var(--blue)', busy: false,
      tooltip: `${result.league ? 'Ligue entière. ' : ''}Vitesse effective ×${result.speed}. ${result.completed}/${result.runs} parcours terminés.`,
    });
  } catch (error) {
    badge.update({text: 'XP/h Indisponible', color: 'var(--text)', busy: false,
      tooltip: error instanceof Error ? error.message : String(error)});
  }
});
