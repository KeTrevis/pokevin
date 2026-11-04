export interface Mon {
  uid: string;
  id: number;
  level: number;
  xp: number;
  shiny?: boolean;
  rank?: number;
  hp?: number;
  status?: string;
  confused?: number;
  wins?: number;
  caughtAt?: number;
  where?: string;
  reg?: string;
}

export interface StoryStep {
  kind: string;
  name: string;
  leader: string;
  badge: string;
}

export interface AdventureState {
  chapter: number;
  unlocked: number;
  layout: number;
  nodes: Array<StoryStep & { type: string; ch?: number; gym?: StoryStep }>;
  node: number;
  battle: { enemies: Mon[] } | null;
  pending: { type: string } | null;
  event: object | null;
  zone: object | null;
  tower: object | null;
  badges: string[];
  gifts: Record<string, boolean>;
  kept: Record<string, string[]>;
  loops: Array<number | string>;
  capture?: { on: boolean };
  paused?: boolean;
  speed?: number;
}

export interface Save {
  v: number;
  mons: Mon[];
  team: string[];
  road?: string[];
  adv: AdventureState;
  travel?: { to: string[] };
  stats: Record<string, number>;
  buddy: { uid: string | null; ko: number };
  trainer: Record<string, unknown>;
  items: Record<string, number>;
  dex: Record<string, unknown>;
  seen: Record<string, unknown>;
  seenShiny: Record<string, unknown>;
  eventTeams: Record<string, unknown>;
  autoSwitch?: boolean;
}

export interface Evolution { uid: string; from: number; to: number; forced?: boolean }
export interface CombatEvent {
  type: string;
  kind?: string;
  chapter?: number;
  uid?: string;
  amount?: number;
  evolve?: Evolution;
  fed?: Array<{ evolve?: Evolution }>;
  candy?: { fed?: Array<{ evolve?: Evolution }> };
}
export interface Champion {
  id: string; chapter: number; name: string; badge: string; region: string; chapterName: string;
  enemies: Array<{ id: number; name: string; level: number }>;
}
export interface TeamMon {
  uid: string; id: number; name: string; level: number; shiny: boolean; rank: number; hp: number;
}
export interface PreparedTeam { state: Save; team: TeamMon[]; now: number; autoSwitch: boolean; pendingTeam: boolean }
export interface PreparedFight extends PreparedTeam { champion: Champion }
export interface FightResult { won: boolean; progress: number; actions: number; survivors: number }
export interface Progress { done: number; runs: number }
export interface WorkerRequest { type: 'run' | 'optimize' | 'xp'; requestId: number; chapter: number; save: Save }
export type ControlRequest = WorkerRequest | { type: 'ping' | 'cancel' };
export type ReadyReply = { type: 'ready'; bundle: string; chapters: number[] };
export type ErrorReply = { type: 'error'; requestId: number; message?: string } | { type: 'unavailable'; requestId: number; message?: string };
export type XPReply = ReadyReply | ErrorReply | ({ type: 'result'; requestId: number } & XPResult) | ({ type: 'progress'; requestId: number } & Progress);
export type GymReply = ReadyReply | ErrorReply | { type: 'pong' } | ({ type: 'result'; requestId: number } & GymResult) | ({ type: 'progress'; requestId: number } & Progress);
export type OptimizationReply = ReadyReply | ErrorReply | ({ type: 'optimization-result'; requestId: number } & OptimizationResult) | ({ type: 'optimization-progress'; requestId: number } & OptimizationProgress);
export interface XPResult {
  xpPerHour: number; xp: number; elapsedMs: number; runs: number; completed: number;
  defeats: number; speed: number; league: boolean; now: number;
}
export interface GymResult {
  probability: number; wins: number; runs: number; champion: string; interval: number[];
  pendingTeam: boolean; now: number;
}
export interface OptimizationProgress { stage: string; teams: number; trials: number; candidates: number }
export interface OptimizationResult {
  champion: string; team: TeamMon[]; probability: number; wins: number; runs: number;
  currentProbability: number | null; currentWins: number | null; unchanged: boolean;
  available: number; tested: number; trials: number; now: number;
}
export interface Advice {
  status: 'idle' | 'searching' | 'applying' | 'result' | 'error';
  chapter?: number; result?: OptimizationResult; stage?: string; teams?: number;
  applied?: boolean; message?: string;
}
export type EstimateResult<T> = T | { error: string };
export interface ChapterVisit {
  chapter: number; save?: Save; xpStarted: boolean; gymStarted: boolean;
  xp?: EstimateResult<XPResult>; gym?: EstimateResult<GymResult>;
}

// Public surface used from the generated game engine; its implementation stays untouched.
export interface Engine {
  setSnapshotTime(now: number): void;
  CONFIG: { TEAM_SIZE: number; MAX_LEVEL: number; ACTION_MS: number; UNDERGROUND: { RANK_MAX: number } };
  STORY: {
    REGIONS: Array<{ key: string; name: string; open: boolean }>;
    CHAPTERS: Array<{ name: string; league?: boolean; steps: StoryStep[] }>;
    regionOf(chapter: number): { key: string; name: string };
    gymTeam(chapter: number, gym: StoryStep): Array<[number, number]>;
    leagueOf(chapter: number): number[] | null;
  };
  Game: {
    S: Save;
    DEX: Record<number, { name: string }>;
    freshState(): Save;
    sandbox<T>(state: Save, run: () => T): T;
    can(mon: Mon): string | null;
    beingOf(mon: Mon): string;
    healTeam(): void;
    teamMons(): Mon[];
    getMon(uid: string): Mon;
    rankOf(mon: Mon): number;
    maxHp(mon: Mon): number;
    curHp(mon: Mon): number;
    evoBlocked(mon: Mon, to: number): boolean;
    levelEvolutions(mon: Mon): unknown[];
    evolveMon(uid: string, to: number): unknown;
    makeMon(id: number, level: number, options: { shiny: boolean }): Mon;
  };
  Adventure: {
    step(): CombatEvent[];
    buildChapter(chapter: number): void;
    loopKey(chapter: number): number | string;
    speed(): number;
    counterValue(ally: Mon, enemy: Mon, level: number): number;
  };
}

export interface Simulator {
  restoreRegions(save: Save): void;
  champions(save: Save): Champion[];
  available(save: Save): Array<{ uid: string; group: string }>;
  prepareTeam(save: Save, now?: number, teamIds?: string[]): PreparedTeam;
  prepare(save: Save, championId: string, now?: number, teamIds?: string[]): PreparedFight;
  fight(prepared: PreparedFight, trace?: CombatEvent[] | null, seed?: number): FightResult;
  applyEvolutions(events: CombatEvent[], requireChoice?: boolean): void;
  interval(wins: number, runs: number): number[];
}

export interface TrainerPreviewBase {
  key: string; name: string; location: string; count?: number;
  sprite?: string; boss?: number;
  team: Array<{ id: number; name: string; level?: number; min?: number; max?: number }>;
}

export type TrainerPreview = TrainerPreviewBase & ({ random: true; size: [number, number]; classes: Array<{ name: string; sprite: string }> } | { random?: false });

export interface BadgeProps {
  id: string; label: string; icon?: string; value?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'info' | 'caution';
  tooltip?: string; onClick?: import('react').MouseEventHandler;
}
export interface AdvisorProps {
  id: string; advice: Advice; versionMismatch: boolean;
  onSearch(): void; onCancel(): void; onApply(): void;
}
export interface PreviewProps { id: string; trainers: TrainerPreview[]; versionMismatch: boolean }
export interface UI {
  versionWarning: string;
  mountBadge(container: Element, props: BadgeProps): HTMLElement;
  updateBadge(element: Element, patch: Partial<BadgeProps>): void;
  mountAdvisor(after: Element, props: AdvisorProps): HTMLElement;
  updateAdvisor(element: Element, props: AdvisorProps): void;
  mountPreview(after: Element, props: PreviewProps): HTMLDetailsElement;
  updatePreview(element: Element, props: PreviewProps): void;
  disposeDetached(nodes: NodeList): void;
}
