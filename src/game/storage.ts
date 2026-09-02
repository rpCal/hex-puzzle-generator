import type { SessionSnapshot } from '@core/board/session.ts';
import type { Difficulty, Mode } from '@core/rules/presets.ts';

/**
 * Local persistence. No backend, no accounts, no network (SPEC NG2).
 *
 * Every read is wrapped and degrades to a default. Storage is genuinely unavailable in a private
 * window, can be full, and can throw on access when a browser is set to block site data — none of
 * which is a reason for the game not to start.
 *
 * The backing store is injected rather than reached for, so the whole module is testable without a
 * DOM and a caller can supply an in-memory store when persistence is not wanted.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STATS_KEY = 'hexforge.stats.v1';
export const SESSION_KEY = 'hexforge.session.v1';
export const PREFS_KEY = 'hexforge.prefs.v1';

export interface Prefs {
  volume: number;
  reducedMotion: boolean;
  colorblind: boolean;
  highContrastCuts: boolean;
  showReference: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  volume: 0.6,
  reducedMotion: false,
  colorblind: false,
  highContrastCuts: false,
  showReference: true,
};

/**
 * Whether the environment asks for reduced motion.
 *
 * Used as the *default* for the preference, not an override: someone who has turned the toggle on
 * or off has expressed a stronger opinion than their operating system, and their choice persists.
 */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

export interface RunRecord {
  bestSeconds: number;
  completions: number;
  bestStars: number;
  lastPlayed: number;
}

export interface SavedSession {
  puzzle: string;
  snapshot: SessionSnapshot;
  savedAt: number;
}

/** An in-memory store, used when the real one is unavailable and by tests. */
export class MemoryStore implements KeyValueStore {
  readonly #map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

/**
 * The browser's `localStorage`, or an in-memory stand-in.
 *
 * Merely *touching* `localStorage` throws in some configurations, so the probe is a real
 * write/read/delete inside a try, not a truthiness check on the global.
 */
export function defaultStore(): KeyValueStore {
  try {
    const probe = '__hexforge_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return new MemoryStore();
  }
}

export class Persistence {
  readonly #store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.#store = store;
  }

  #read<T>(key: string, fallback: T): T {
    try {
      const raw = this.#store.getItem(key);
      if (raw === null) return fallback;
      const parsed: unknown = JSON.parse(raw);
      return parsed === null || typeof parsed !== 'object' ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
  }

  #write(key: string, value: unknown): boolean {
    try {
      this.#store.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Quota exceeded, or storage disabled mid-session. Losing a save is not worth an exception
      // that would take the frame loop down with it.
      return false;
    }
  }

  // Preferences ------------------------------------------------------------------------------

  loadPrefs(): Prefs {
    const stored = this.#read<Partial<Prefs>>(PREFS_KEY, {});
    return {
      volume: clamp01(numberOr(stored.volume, DEFAULT_PREFS.volume)),
      // The system preference is the default; a stored choice overrides it.
      reducedMotion: boolOr(stored.reducedMotion, prefersReducedMotion()),
      colorblind: boolOr(stored.colorblind, DEFAULT_PREFS.colorblind),
      highContrastCuts: boolOr(stored.highContrastCuts, DEFAULT_PREFS.highContrastCuts),
      showReference: boolOr(stored.showReference, DEFAULT_PREFS.showReference),
    };
  }

  savePrefs(prefs: Prefs): boolean {
    return this.#write(PREFS_KEY, prefs);
  }

  // Stats ------------------------------------------------------------------------------------

  /** Key for one configuration of a puzzle. Distinct modes and difficulties keep separate records. */
  static runKey(puzzleCode: string, mode: Mode, difficulty: Difficulty): string {
    return `${puzzleCode}|${mode}|${difficulty}`;
  }

  loadStats(): Record<string, RunRecord> {
    return this.#read<Record<string, RunRecord>>(STATS_KEY, {});
  }

  /** Record a completed run, keeping the best time and best rating. Returns true if it was a record. */
  recordRun(key: string, seconds: number, stars: number): boolean {
    const stats = this.loadStats();
    const existing = stats[key];
    const isRecord = existing === undefined || seconds < existing.bestSeconds;
    stats[key] = {
      bestSeconds: existing === undefined ? seconds : Math.min(existing.bestSeconds, seconds),
      completions: (existing?.completions ?? 0) + 1,
      bestStars: Math.max(existing?.bestStars ?? 0, stars),
      lastPlayed: Date.now(),
    };
    this.#write(STATS_KEY, stats);
    return isRecord;
  }

  bestFor(key: string): RunRecord | null {
    return this.loadStats()[key] ?? null;
  }

  // In-progress board ------------------------------------------------------------------------

  saveSession(puzzle: string, snapshot: SessionSnapshot): boolean {
    return this.#write(SESSION_KEY, { puzzle, snapshot, savedAt: Date.now() });
  }

  /** The saved board, but only if it belongs to the puzzle being asked about. */
  loadSession(puzzle: string): SavedSession | null {
    const saved = this.#read<Partial<SavedSession>>(SESSION_KEY, {});
    if (saved.puzzle !== puzzle || saved.snapshot === undefined) return null;
    return saved as SavedSession;
  }

  clearSession(): void {
    try {
      this.#store.removeItem(SESSION_KEY);
    } catch {
      // Nothing useful to do; the stale entry is rejected on load anyway.
    }
  }
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const boolOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Call `fn` at most once every `delayMs`, and once more after the last call.
 *
 * The in-progress board is written on a debounce because a snap can happen several times a second
 * and serialising a thousand-piece board on each one would be felt.
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delayMs: number,
): ((...args: T) => void) & { flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  const run = (): void => {
    timer = null;
    if (pending !== null) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };

  const wrapped = (...args: T): void => {
    pending = args;
    if (timer === null) timer = setTimeout(run, delayMs);
  };

  wrapped.flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    run();
  };
  wrapped.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return wrapped;
}
