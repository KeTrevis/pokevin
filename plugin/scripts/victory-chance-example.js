// @ts-check
import source from './victory-chance.js?raw';
import badgeSource from './victory-badge.js?raw';

globalThis.PokevinExampleScript = {
  id: 'example-victory-chance',
  name: 'Calculateur de victoire',
  code: (source.replace('globalThis.PokevinVictoryChance = async function* (', 'async function* calculateVictoryChance(')
    .replace(/\n};\s*$/, '\n}') + '\n\n' + badgeSource.replaceAll('globalThis.PokevinVictoryChance', 'calculateVictoryChance'))
    .replace(/^[ \t]*\/\/[^\n]*\n/gm, ''),
  autoStart: true,
};
