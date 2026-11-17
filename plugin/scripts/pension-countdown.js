// @ts-check
// Preserve the game's localized countdown rather than recomputing its timers.
/**
 * @type {Element[]}
 */
let pensionRows = [];
pokevin.ui.observe('#pen-res .pen-row', rows => {
  pensionRows = rows;
  for (const row of rows) {
    const title = row.getAttribute('title') || '';
    const separator = title.lastIndexOf(' · ');
    const next = separator < 0 ? '' : title.slice(separator + 3).trim();
    if (!next) row.removeAttribute('data-pc-egg-next');
    else if (row.getAttribute('data-pc-egg-next') !== next)
      row.setAttribute('data-pc-egg-next', next);
  }
}, () => {
  for (const row of pensionRows) row.removeAttribute('data-pc-egg-next');
  pensionRows = [];
});
