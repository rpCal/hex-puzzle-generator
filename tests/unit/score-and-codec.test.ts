import { describe, it, expect } from 'vitest';
import {
  parSeconds,
  parFor,
  starsFor,
  scoreRun,
  formatDuration,
  STAR_THRESHOLDS,
  MODE_PAR_MULTIPLIER,
} from '@core/score/par.ts';
import {
  CODEC_VERSION,
  ENCODED_LENGTH,
  clampPuzzleId,
  decodePuzzleId,
  encodePuzzleId,
  fromUrlHash,
  toUrlHash,
  type PuzzleId,
} from '@core/seed/codec.ts';
import {
  DIFFICULTIES,
  DIFFICULTY_COUNT,
  Difficulty,
  MODES,
  MODE_COUNT,
  Mode,
  difficultyInfo,
  modeInfo,
} from '@core/rules/presets.ts';
import { pieceCount } from '@core/math/hex.ts';
import { Rng } from '@core/rng/hash32.ts';

describe('par', () => {
  it('is strictly increasing in piece count', () => {
    let previous = -1;
    for (const n of [1, 7, 19, 37, 91, 217, 469, 1027]) {
      const par = parSeconds(n);
      expect(par).toBeGreaterThan(previous);
      previous = par;
    }
  });

  it('grows faster than linearly, because search cost grows with the board', () => {
    // Doubling the pieces must more than double the par, or big boards would be unratable.
    const small = parSeconds(200);
    const large = parSeconds(400);
    expect(large).toBeGreaterThan(small * 2);
  });

  it('gives sane wall-clock numbers at both ends', () => {
    expect(parSeconds(7)).toBeGreaterThan(15);
    expect(parSeconds(7)).toBeLessThan(40);
    expect(parSeconds(1027)).toBeGreaterThan(20 * 60);
    expect(parSeconds(1027)).toBeLessThan(90 * 60);
  });

  it('never returns a non-positive par, even for nonsense input', () => {
    for (const n of [0, -1, -1000]) expect(parSeconds(n)).toBeGreaterThan(0);
  });

  it('applies a mode multiplier', () => {
    expect(parFor(91, 'rotation')).toBeGreaterThan(parFor(91, 'classic'));
    expect(parFor(91, 'mirror')).toBeGreaterThan(parFor(91, 'classic'));
    expect(parFor(91, 'classic')).toBe(parSeconds(91));
  });

  it('never makes a mode easier than classic', () => {
    for (const m of Object.values(MODE_PAR_MULTIPLIER)) expect(m).toBeGreaterThanOrEqual(1);
  });
});

describe('stars', () => {
  it('awards three, two, one and zero at the documented thresholds', () => {
    const par = 100;
    expect(starsFor(par * STAR_THRESHOLDS.three, par)).toBe(3);
    expect(starsFor(par * STAR_THRESHOLDS.three + 0.01, par)).toBe(2);
    expect(starsFor(par, par)).toBe(2);
    expect(starsFor(par + 0.01, par)).toBe(1);
    expect(starsFor(par * STAR_THRESHOLDS.one, par)).toBe(1);
    expect(starsFor(par * STAR_THRESHOLDS.one + 0.01, par)).toBe(0);
  });

  it('is monotonically non-increasing in elapsed time', () => {
    const par = 200;
    let previous = 3;
    for (let t = 0; t < 500; t += 5) {
      const stars = starsFor(t, par);
      expect(stars).toBeLessThanOrEqual(previous);
      previous = stars;
    }
  });

  it('degrades safely on nonsense input', () => {
    expect(starsFor(-5, 100)).toBe(0);
    expect(starsFor(10, 0)).toBe(0);
    expect(starsFor(10, -1)).toBe(0);
    expect(starsFor(Number.NaN, 100)).toBe(0);
  });
});

describe('scoreRun', () => {
  it('reports par, stars and a clamped ratio together', () => {
    const fast = scoreRun(10, 91);
    expect(fast.stars).toBe(3);
    expect(fast.underPar).toBe(true);
    expect(fast.ratio).toBeGreaterThan(0);
    expect(fast.ratio).toBeLessThan(1);

    const slow = scoreRun(100_000, 91);
    expect(slow.stars).toBe(0);
    expect(slow.underPar).toBe(false);
    expect(slow.ratio).toBe(1);
  });
});

describe('formatDuration', () => {
  it('formats m:ss below an hour and h:mm:ss above', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3671)).toBe('1:01:11');
  });

  it('clamps negatives to zero', () => {
    expect(formatDuration(-42)).toBe('0:00');
  });
});

describe('presets', () => {
  it('lists every mode and difficulty in id order', () => {
    expect(MODES).toHaveLength(MODE_COUNT);
    expect(DIFFICULTIES).toHaveLength(DIFFICULTY_COUNT);
    MODES.forEach((m, i) => expect(m.id).toBe(i));
    DIFFICULTIES.forEach((d, i) => expect(d.id).toBe(i));
  });

  it('has unique keys', () => {
    expect(new Set(MODES.map((m) => m.key)).size).toBe(MODE_COUNT);
    expect(new Set(DIFFICULTIES.map((d) => d.key)).size).toBe(DIFFICULTY_COUNT);
  });

  it('piece counts agree with the rings and the closed form', () => {
    for (const d of DIFFICULTIES) expect(d.pieces).toBe(pieceCount(d.rings));
  });

  it('gets harder monotonically: more pieces, smaller tabs, more jitter', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const prev = DIFFICULTIES[i - 1]!;
      const cur = DIFFICULTIES[i]!;
      expect(cur.pieces).toBeGreaterThan(prev.pieces);
      expect(cur.tab.tabSize).toBeLessThan(prev.tab.tabSize);
      expect(cur.tab.jitter).toBeGreaterThan(prev.tab.jitter);
    }
  });

  it('falls back safely for an unknown id', () => {
    expect(modeInfo(99 as Mode).id).toBe(Mode.Classic);
    expect(difficultyInfo(99 as Difficulty).id).toBe(Difficulty.Standard);
  });

  it('marks exactly the modes that should rotate, hide and time', () => {
    expect(modeInfo(Mode.Rotation).rotates).toBe(true);
    expect(modeInfo(Mode.Classic).rotates).toBe(false);
    expect(modeInfo(Mode.Mirror).hidesReference).toBe(true);
    expect(modeInfo(Mode.Zen).timed).toBe(false);
    expect(modeInfo(Mode.Blitz).fadeSeconds).toBeGreaterThan(0);
  });
});

describe('puzzle id codec', () => {
  const sample: PuzzleId = {
    version: CODEC_VERSION,
    mode: Mode.Rotation,
    difficulty: Difficulty.Hard,
    rings: 8,
    seed: 0xdeadbeef,
    imageId: 0xabcdef,
  };

  it('encodes to exactly twelve url-safe characters', () => {
    const encoded = encodePuzzleId(sample);
    expect(encoded).toHaveLength(ENCODED_LENGTH);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('round-trips', () => {
    expect(decodePuzzleId(encodePuzzleId(sample))).toEqual(sample);
  });

  it('round-trips under fuzzing', () => {
    const rng = new Rng(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const id: PuzzleId = {
        version: CODEC_VERSION,
        mode: rng.int(MODE_COUNT) as Mode,
        difficulty: rng.int(DIFFICULTY_COUNT) as Difficulty,
        rings: 1 + rng.int(31),
        seed: (rng.next() * 0xffffffff) >>> 0,
        imageId: rng.int(0x1000000),
      };
      expect(decodePuzzleId(encodePuzzleId(id))).toEqual(id);
    }
  });

  it('produces a different code for every field change', () => {
    const base = encodePuzzleId(sample);
    expect(encodePuzzleId({ ...sample, seed: sample.seed + 1 })).not.toBe(base);
    expect(encodePuzzleId({ ...sample, rings: 9 })).not.toBe(base);
    expect(encodePuzzleId({ ...sample, mode: Mode.Zen })).not.toBe(base);
    expect(encodePuzzleId({ ...sample, difficulty: Difficulty.Casual })).not.toBe(base);
    expect(encodePuzzleId({ ...sample, imageId: 1 })).not.toBe(base);
  });

  it('rejects malformed input rather than returning a garbage board', () => {
    // A mistyped link should drop the player into the default puzzle with a notice, not into a
    // board with 200 rings or a mode that does not exist.
    for (const bad of [
      '',
      'short',
      'waaaaytoolongforthis',
      'twelve!chars', //   invalid characters
      '............',
      'AAAAAAAAAAA', //    eleven
      'AAAAAAAAAAAAA', //  thirteen
    ]) {
      expect(decodePuzzleId(bad)).toBeNull();
    }
  });

  it('rejects out-of-range field values', () => {
    // rings = 0 is not a playable board.
    expect(decodePuzzleId(encodePuzzleId({ ...sample, rings: 0 }))).toBeNull();
    // mode 7 does not exist.
    expect(decodePuzzleId(encodePuzzleId({ ...sample, mode: 7 as Mode }))).toBeNull();
    // difficulty 7 does not exist.
    expect(decodePuzzleId(encodePuzzleId({ ...sample, difficulty: 7 as Difficulty }))).toBeNull();
    // A future version is not silently reinterpreted.
    expect(decodePuzzleId(encodePuzzleId({ ...sample, version: 2 }))).toBeNull();
  });

  it('never throws, whatever it is fed', () => {
    const rng = new Rng(5);
    const alphabet = 'ABCxyz019-_!@#$%^&*(). ';
    for (let i = 0; i < 3000; i++) {
      let text = '';
      const length = rng.int(20);
      for (let k = 0; k < length; k++) text += alphabet[rng.int(alphabet.length)];
      expect(() => decodePuzzleId(text)).not.toThrow();
    }
  });
});

describe('url hash', () => {
  const sample: PuzzleId = {
    version: CODEC_VERSION,
    mode: Mode.Classic,
    difficulty: Difficulty.Standard,
    rings: 5,
    seed: 12345,
    imageId: 3,
  };

  it('round-trips through a full URL', () => {
    const hash = toUrlHash(sample);
    expect(hash.startsWith('#p=')).toBe(true);
    expect(fromUrlHash(`https://rpcal.github.io/hex-puzzle-generator/${hash}`)).toEqual(sample);
  });

  it('accepts a bare fragment or a bare code', () => {
    const code = encodePuzzleId(sample);
    expect(fromUrlHash(`#p=${code}`)).toEqual(sample);
    expect(fromUrlHash(code)).toEqual(sample);
    expect(fromUrlHash(`  ${code}  `)).toEqual(sample);
  });

  it('returns null for a URL with no puzzle in it', () => {
    expect(fromUrlHash('https://example.com/')).toBeNull();
    expect(fromUrlHash('#other=thing')).toBeNull();
  });
});

describe('clampPuzzleId', () => {
  it('passes valid values through', () => {
    const id = clampPuzzleId({ mode: Mode.Blitz, difficulty: Difficulty.Brutal, rings: 12, seed: 7, imageId: 9 });
    expect(id).toEqual({
      version: CODEC_VERSION,
      mode: Mode.Blitz,
      difficulty: Difficulty.Brutal,
      rings: 12,
      seed: 7,
      imageId: 9,
    });
  });

  it('repairs out-of-range values into something encodable', () => {
    const id = clampPuzzleId({ mode: 99 as Mode, difficulty: -1 as Difficulty, rings: 5000, seed: -1, imageId: 0xffffffff });
    expect(id.mode).toBe(Mode.Classic);
    expect(id.difficulty).toBe(Difficulty.Standard);
    expect(id.rings).toBe(31);
    expect(id.seed).toBe(0xffffffff);
    expect(id.imageId).toBe(0xffffff);
    expect(decodePuzzleId(encodePuzzleId(id))).toEqual(id);
  });

  it('fills in defaults for an empty request', () => {
    const id = clampPuzzleId({});
    expect(decodePuzzleId(encodePuzzleId(id))).toEqual(id);
  });

  it('always produces something the decoder accepts', () => {
    const rng = new Rng(77);
    for (let i = 0; i < 500; i++) {
      const id = clampPuzzleId({
        mode: (rng.int(50) - 10) as Mode,
        difficulty: (rng.int(50) - 10) as Difficulty,
        rings: rng.int(500) - 100,
        seed: (rng.next() * 1e12) | 0,
        imageId: (rng.next() * 1e12) | 0,
      });
      expect(decodePuzzleId(encodePuzzleId(id))).toEqual(id);
    }
  });
});
