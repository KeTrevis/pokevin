import { XPTarget } from './domain';

export interface ChapterView { chapterId: XPTarget }
export interface ChapterBadgeProps {
  text: string;
  /** Any valid CSS color, including the game's variables, e.g. var(--green). */
  color?: string;
  tooltip?: string;
  id?: string;
  busy?: boolean;
  data?: Record<string, string>;
  /** Bundle used for this result; a mismatch adds a warning to the tooltip. */
  gameBundle?: string;
}
export interface ChapterBadge {
  update(props: Partial<ChapterBadgeProps>): void;
  remove(): void;
}
export interface ChapterViewScope {
  /** Badges are removed and simulations closed when this visit ends. */
  ui: ScriptUI['ui'];
  battles: import('./battles').Battles;
}
export interface ScriptUI {
  ui: { chapterBadge(chapterId: XPTarget, props: ChapterBadgeProps): ChapterBadge };
  chapters: {
    /** Immediately receives the current view, then changes; null when the chapter closes. */
    onViewed(callback: (view: ChapterView | null, scope: ChapterViewScope) => unknown): () => void;
  };
}
export interface ScriptAPI extends ScriptUI {
  battles: import('./battles').Battles;
  saves: { read(): import('./domain').Save };
}
