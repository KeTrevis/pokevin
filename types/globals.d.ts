declare var PokeCatchEngine: import('./domain').Engine;
declare var GymSimulator: import('./domain').Simulator;
declare var EncounterSimulator: {
  team(save: import('./domain').Save, id: string): string[];
  catalog(): import('./domain').Encounter[];
  prepare(save: import('./domain').Save, id: string, now?: number, teamIds?: string[]): import('./domain').PreparedFight;
  available(save: import('./domain').Save, id: string): Array<{ uid: string; group: string }>;
  fight(prepared: import('./domain').PreparedFight, trace?: import('./domain').CombatEvent[] | null, seed?: number): import('./domain').FightResult;
  interval(wins: number, runs: number): number[];
};
declare var ChapterXP: {
  estimate(save: import('./domain').Save, chapter: import('./domain').XPTarget, now?: number): Generator<import('./domain').Progress, import('./domain').XPResult, unknown>;
};
declare var TeamOptimizer: {
  search(save: import('./domain').Save, championId: string, now?: number): Generator<import('./domain').OptimizationProgress, import('./domain').OptimizationResult, unknown>;
};
declare var PokeCatchTeams: { apply(team: import('./domain').TeamMon[], chapter: number): Promise<void>; applyEncounter(team: import('./domain').TeamMon[], id: string): Promise<void> };
declare var PokeCatchUI: import('./domain').UI;
declare var PokeCatchChapterData: { bundle: string; chapters: Array<{ trainers: import('./domain').TrainerPreview[] }> };
declare function importScripts(...urls: string[]): void;
