// @ts-check
// Reuse the game's localized countdown, refreshed by its own pension ticks.
function showEggCountdown() {
  for (const row of document.querySelectorAll('#pen-res .pen-row[title]')) {
    const title = row.getAttribute('title') || '';
    const separator = title.lastIndexOf(' · ');
    if (separator < 0) {
      row.removeAttribute('data-pc-egg-next');
      continue;
    }
    const next = title.slice(separator + 3).trim();
    if (row.getAttribute('data-pc-egg-next') !== next)
      row.setAttribute('data-pc-egg-next', next);
  }
}

new MutationObserver(showEggCountdown).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['title', 'data-pc-egg-next'],
});
showEggCountdown();
