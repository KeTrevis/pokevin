import { Save, AdventureTarget, CombatEvent } from './domain';
/** Native adventure events; item/currency gains can be measured independently of XP. */
export interface AdventureEvent extends CombatEvent {
  item?: string;
  n?: number;
  money?: number;
  coins?: number;
  success?: boolean;
}
/** One independent route with the selected team healed; captures do not change it.
 * Gifts/trades are skipped without rewards. Manual evolution choices throw.
 * Stops at first defeat or chapter/circuit completion, within 20,000 actions. */
export interface AdventureResult {
  events: AdventureEvent[];
  teamIds: string[];
  elapsedMs: number;
  actions: number;
  outcome: 'completed' | 'defeat';
  speed: number;
  league: boolean;
  now: number;
}
/** Raw native events and nominal live time (excluding animations/pauses).
 * Supports accessible chapters in the current region, league circuits and legendary zones.
 * Each call starts from the supplied snapshot; cancellation closes its session. */
export type Simulate = (save: Save, target: AdventureTarget, options?: {now?: number}) => Promise<AdventureResult>;
