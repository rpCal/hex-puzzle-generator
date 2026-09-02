import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MemoryStore,
  Persistence,
  DEFAULT_PREFS,
  PREFS_KEY,
  SESSION_KEY,
  STATS_KEY,
  debounce,
  type KeyValueStore,
} from '@game/storage.ts';
import { generateCut } from '@core/cut/board.ts';
import { PuzzleSession } from '@core/board/session.ts';
import { Difficulty, Mode } from '@core/rules/presets.ts';

/** A store that throws on every operation, the way a locked-down browser behaves. */
class HostileStore implements KeyValueStore {
  getItem(): string | null {
    throw new Error('denied');
  }
  setItem(): void {
    throw new Error('quota exceeded');
  }
  removeItem(): void {
    throw new Error('denied');
  }
}

const board = generateCut({
  seed: 99,
  shape: { kind: 'hex', rings: 1 },
  radius: 52,
  tab: { tabSize: 0.18, jitter: 0.05 },
});

describe('preferences', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(new Persistence(new MemoryStore()).loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('round-trips', () => {
    const store = new MemoryStore();
    const p = new Persistence(store);
    const prefs = { ...DEFAULT_PREFS, volume: 0.25, colorblind: true };
    expect(p.savePrefs(prefs)).toBe(true);
    expect(new Persistence(store).loadPrefs()).toEqual(prefs);
  });

  it('repairs a stored value of the wrong shape rather than trusting it', () => {
    const store = new MemoryStore();
    store.setItem(PREFS_KEY, JSON.stringify({ volume: 'loud', colorblind: 'yes', bogus: 1 }));
    const prefs = new Persistence(store).loadPrefs();
    expect(prefs.volume).toBe(DEFAULT_PREFS.volume);
    expect(prefs.colorblind).toBe(DEFAULT_PREFS.colorblind);
  });

  it('clamps volume into range', () => {
    const store = new MemoryStore();
    store.setItem(PREFS_KEY, JSON.stringify({ volume: 9 }));
    expect(new Persistence(store).loadPrefs().volume).toBe(1);
    store.setItem(PREFS_KEY, JSON.stringify({ volume: -3 }));
    expect(new Persistence(store).loadPrefs().volume).toBe(0);
  });

  it('survives corrupt JSON', () => {
    const store = new MemoryStore();
    store.setItem(PREFS_KEY, '{not json');
    expect(new Persistence(store).loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('survives a store that throws on every call', () => {
    // A private window, a full quota, or a browser set to block site data. None of these is a
    // reason for the game not to start.
    const p = new Persistence(new HostileStore());
    expect(() => p.loadPrefs()).not.toThrow();
    expect(p.loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(p.savePrefs(DEFAULT_PREFS)).toBe(false);
    expect(() => p.clearSession()).not.toThrow();
    expect(p.loadStats()).toEqual({});
  });
});

describe('run records', () => {
  it('keeps the best time and the best rating', () => {
    const p = new Persistence(new MemoryStore());
    const key = Persistence.runKey('ABCDEFGHIJKL', Mode.Classic, Difficulty.Casual);

    expect(p.recordRun(key, 120, 2)).toBe(true);
    expect(p.bestFor(key)).toMatchObject({ bestSeconds: 120, completions: 1, bestStars: 2 });

    // Slower run: not a record, but it still counts as a completion and cannot lower the rating.
    expect(p.recordRun(key, 200, 3)).toBe(false);
    expect(p.bestFor(key)).toMatchObject({ bestSeconds: 120, completions: 2, bestStars: 3 });

    expect(p.recordRun(key, 90, 1)).toBe(true);
    expect(p.bestFor(key)).toMatchObject({ bestSeconds: 90, completions: 3, bestStars: 3 });
  });

  it('keeps modes and difficulties apart', () => {
    const p = new Persistence(new MemoryStore());
    const classic = Persistence.runKey('X', Mode.Classic, Difficulty.Casual);
    const rotation = Persistence.runKey('X', Mode.Rotation, Difficulty.Casual);
    const harder = Persistence.runKey('X', Mode.Classic, Difficulty.Hard);
    expect(new Set([classic, rotation, harder]).size).toBe(3);

    p.recordRun(classic, 10, 3);
    expect(p.bestFor(rotation)).toBeNull();
    expect(p.bestFor(harder)).toBeNull();
  });

  it('returns null for a puzzle never played', () => {
    expect(new Persistence(new MemoryStore()).bestFor('nope')).toBeNull();
  });

  it('ignores corrupt stats', () => {
    const store = new MemoryStore();
    store.setItem(STATS_KEY, 'garbage');
    expect(new Persistence(store).loadStats()).toEqual({});
  });
});

describe('in-progress board', () => {
  const session = (): PuzzleSession => {
    const s = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 3 });
    s.scatter();
    return s;
  };

  it('round-trips a snapshot for the same puzzle', () => {
    const store = new MemoryStore();
    const p = new Persistence(store);
    const source = session();
    source.grab(0);
    source.dragTo({ x: 40, y: 40 });
    source.release();

    expect(p.saveSession('CODE12345678', source.serialize())).toBe(true);
    const loaded = p.loadSession('CODE12345678');
    expect(loaded).not.toBeNull();

    const restored = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 3 });
    expect(restored.restore(loaded!.snapshot)).toBe(true);
    for (let i = 0; i < board.pieces.length; i++) {
      expect(restored.clusters.worldPosition(i)).toEqual(source.clusters.worldPosition(i));
    }
  });

  it('refuses a snapshot saved for a different puzzle', () => {
    // Restoring a board belonging to another cut would place pieces at meaningless positions.
    const p = new Persistence(new MemoryStore());
    p.saveSession('AAAAAAAAAAAA', session().serialize());
    expect(p.loadSession('BBBBBBBBBBBB')).toBeNull();
    expect(p.loadSession('AAAAAAAAAAAA')).not.toBeNull();
  });

  it('clears', () => {
    const store = new MemoryStore();
    const p = new Persistence(store);
    p.saveSession('CODE', session().serialize());
    p.clearSession();
    expect(store.getItem(SESSION_KEY)).toBeNull();
    expect(p.loadSession('CODE')).toBeNull();
  });

  it('returns null when nothing was ever saved', () => {
    expect(new Persistence(new MemoryStore()).loadSession('CODE')).toBeNull();
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls once for a burst', () => {
    const spy = vi.fn();
    const wrapped = debounce(spy, 100);
    wrapped(1);
    wrapped(2);
    wrapped(3);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(spy).toHaveBeenCalledTimes(1);
    // The most recent arguments win: a save should write the newest board, not the oldest.
    expect(spy).toHaveBeenCalledWith(3);
  });

  it('flush runs the pending call immediately', () => {
    const spy = vi.fn();
    const wrapped = debounce(spy, 1000);
    wrapped('x');
    wrapped.flush();
    expect(spy).toHaveBeenCalledWith('x');
  });

  it('flush with nothing pending does nothing', () => {
    const spy = vi.fn();
    debounce(spy, 100).flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('cancel drops the pending call', () => {
    const spy = vi.fn();
    const wrapped = debounce(spy, 100);
    wrapped('x');
    wrapped.cancel();
    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('MemoryStore', () => {
  it('behaves like the storage interface it stands in for', () => {
    const store = new MemoryStore();
    expect(store.getItem('a')).toBeNull();
    store.setItem('a', '1');
    expect(store.getItem('a')).toBe('1');
    store.removeItem('a');
    expect(store.getItem('a')).toBeNull();
  });
});
