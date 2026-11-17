declare var PokeCatchEngine: import('./domain').Engine;
declare var PokeCatchSave: { parse(raw: string): import('./domain').Save };
declare var GymSimulator: import('./domain').Simulator;
declare var EncounterSimulator: {
  team(save: import('./domain').Save, id: string): string[];
  catalog(): import('./domain').Encounter[];
  roaming(save: import('./domain').Save, chapter: number, now?: number): import('./domain').Encounter | null;
  prepare(save: import('./domain').Save, id: string, now?: number, teamIds?: string[]): import('./domain').PreparedFight;
  available(save: import('./domain').Save, id: string): Array<{ uid: string; group: string }>;
  fight(prepared: import('./domain').PreparedFight, trace?: import('./domain').CombatEvent[] | null, seed?: number): import('./domain').FightResult;
  interval(wins: number, runs: number): number[];
};
declare var PokevinAdventureSDK: { simulate(save: import('./domain').Save, target: import('./domain').AdventureTarget, now?: number): Generator<import('./domain').Progress, import('./adventures').AdventureResult, unknown> };
declare var PokevinChapterXP: (simulate: import('./adventures').Simulate, save: import('./domain').Save, target: import('./domain').AdventureTarget, now?: number) => AsyncGenerator<import('./domain').Progress, import('./domain').XPResult, unknown>;
declare var PokevinCreateSDK: (cleanups: Set<() => void>, active?: () => boolean) => {catalog(): Promise<import('./battles').GameCatalog>; battles: import('./battles').Battles; simulate: import('./adventures').Simulate};
declare var TeamOptimizer: {
  search(save: import('./domain').Save, championId: string, now?: number): Generator<import('./domain').OptimizationProgress, import('./domain').OptimizationResult, unknown>;
};
declare var PokeCatchTeams: { apply(team: import('./domain').TeamMon[], chapter: number | 'L'): Promise<void>; applyEncounter(team: import('./domain').TeamMon[], id: string): Promise<void> };
declare var PokeCatchUI: import('./domain').UI;
declare var PokeCatchChapterData: { bundle: string; chapters: Array<{ region: string; league: boolean; trainers: import('./domain').TrainerPreview[] }> };
declare function importScripts(...urls: string[]): void;

declare var PokevinBackground: () => void;

declare var PokevinBattleSDK: { battles: import('./battles').Battles; connect(port: chrome.runtime.Port): void };
declare var PokevinVictoryChance: import('./battles').VictoryScript;
declare var PokevinExampleScript: { id: string; name: string; code: string; autoStart?: boolean };
declare var PokevinCreateUI: (cleanups: Set<() => void>, active: () => boolean) => import('./script-ui').ScriptUI;

declare module '*?raw' { const source: string; export default source; }

declare var pokevin: import('./script-ui').ScriptAPI;

declare var PokevinXPExampleScript: typeof PokevinExampleScript & {autoStart: boolean};
declare var PokevinDefaultScripts: Array<typeof PokevinExampleScript & {autoStart?: boolean}>;
