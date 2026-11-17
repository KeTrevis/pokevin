import { Save, Champion, Encounter, TeamMon, FightResult, GymResult, Progress } from './domain';

export interface BattleOptions { now?: number; teamIds?: string[] }
export interface Battle {
  champion: Champion;
  team: TeamMon[];
  pendingTeam: boolean;
  now: number;
  /** One independent fight, with the prepared team restored to full health. */
  fight(seed?: number): Promise<FightResult>;
  close(): void;
}
export interface Battles {
  catalog(save: Save): Promise<{ champions: Champion[]; encounters: Encounter[]; bundle: string }>;
  roaming(save: Save, chapter: number, now?: number): Promise<Encounter | null>;
  /** Numeric chapter: roaming first, then gym. String: exact gym or encounter ID, including league:<region> for the full circuit. */
  prepare(save: Save, target: number | string, options?: BattleOptions): Promise<Battle>;
  interval(wins: number, runs: number): Promise<number[]>;
}
export type VictoryScript = (battles: Battles, save: Save, target: number | string) => AsyncGenerator<Progress, GymResult | void, unknown>;
