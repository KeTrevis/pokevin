// @ts-check
import source from './chapter-xp.js?raw';
import badgeSource from './xp-badge.js?raw';

globalThis.PokevinXPExampleScript = {
  id: 'example-chapter-xp', name: 'Calculateur d’XP', autoStart: true,
  code: (source.replace('globalThis.PokevinChapterXP =', 'const calculateChapterXP =') + '\n\n' +
    badgeSource.replaceAll('PokevinChapterXP', 'calculateChapterXP')).replace(/^[ \t]*\/\/[^\n]*\n/gm, ''),
  previousCodes: [], legacyCode: '',
};
globalThis.PokevinBuiltinScripts = [PokevinExampleScript, PokevinXPExampleScript];
