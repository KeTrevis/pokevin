// @ts-check
import source from './chapter-xp.js?raw';
import badgeSource from './xp-badge.js?raw';
import roamingSource from './roaming-timeline.js?raw';
import pensionSource from './pension-countdown.js?raw';

globalThis.PokevinXPExampleScript = {
  id: 'example-chapter-xp', name: 'Calculateur d’XP', autoStart: true,
  code: (source.replace('globalThis.PokevinChapterXP =', 'const calculateChapterXP =') + '\n\n' +
    badgeSource.replaceAll('PokevinChapterXP', 'calculateChapterXP')).replace(/^[ \t]*\/\/[^\n]*\n/gm, ''),
};
globalThis.PokevinDefaultScripts = [PokevinExampleScript, PokevinXPExampleScript, {
  id: 'builtin-roaming-timeline', name: 'Pokémon errant dans la timeline', autoStart: true,
  code: roamingSource,
}, {
  id: 'builtin-pension-countdown', name: 'Compte à rebours des œufs', autoStart: true,
  code: pensionSource,
}];
