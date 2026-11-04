declare var PokeCatchEngine: import('./domain').Engine;
declare var GymSimulator: import('./domain').Simulator;
declare var ChapterXP: {
  estimate(save: import('./domain').Save, chapter: number, now?: number): Generator<import('./domain').Progress, import('./domain').XPResult, unknown>;
};
declare var TeamOptimizer: {
  search(save: import('./domain').Save, championId: string, now?: number): Generator<import('./domain').OptimizationProgress, import('./domain').OptimizationResult, unknown>;
};
declare var PokeCatchTeams: { apply(team: import('./domain').TeamMon[], chapter: number): Promise<void> };
declare var PokeCatchUI: import('./domain').UI;
declare var PokeCatchChapterData: { bundle: string; chapters: Array<{ trainers: import('./domain').TrainerPreview[] }> };
declare function importScripts(...urls: string[]): void;
