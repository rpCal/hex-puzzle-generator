import { describe, it, expect } from 'vitest';
import {
  hash32,
  hashAt,
  randomAt,
  uniformAt,
  jitterAt,
  boolAt,
  intAt,
  Rng,
  seedFromString,
} from '@core/rng/hash32.ts';

describe('hash32', () => {
  it('returns an unsigned 32-bit integer', () => {
    for (const x of [0, 1, -1, 0x7fffffff, 0xffffffff, 123456789]) {
      const h = hash32(x);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('avalanches: neighbouring inputs are uncorrelated', () => {
    // A single-bit input change should flip roughly half the output bits. Anything much below
    // 40% would mean the finaliser is not mixing and the cut would show visible structure.
    let totalFlipped = 0;
    const trials = 512;
    for (let i = 0; i < trials; i++) {
      const a = hash32(i);
      const b = hash32(i + 1);
      let x = a ^ b;
      let bits = 0;
      while (x !== 0) {
        bits += x & 1;
        x >>>= 1;
      }
      totalFlipped += bits;
    }
    const avg = totalFlipped / trials;
    expect(avg).toBeGreaterThan(12);
    expect(avg).toBeLessThan(20);
  });

  it('is collision-free over a large contiguous range', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50_000; i++) seen.add(hash32(i));
    expect(seen.size).toBe(50_000);
  });

  it('is stable across runs (golden values)', () => {
    // If these change, every previously shared seed produces a different puzzle. That is a
    // breaking change and this test exists to make it a deliberate one.
    expect(hash32(0)).toBe(0);
    expect(hash32(1)).toBe(0x688990c0);
    expect(hash32(0xffffffff)).toBe(0x6768824a);
  });
});

describe('hashAt', () => {
  it('separates id from channel', () => {
    // XOR-folding would make these collide, which would correlate an edge's tab size with its
    // jitter and produce a visibly regular cut.
    expect(hashAt(1, 7, 3)).not.toBe(hashAt(1, 3, 7));
  });

  it('is independent of evaluation order', () => {
    // The whole reason this is a hash and not a stream: the cut generator must be able to ask for
    // edge 900 without having generated edges 0..899.
    const direct = hashAt(42, 900, 2);
    for (let i = 0; i < 900; i++) hashAt(42, i, 2);
    expect(hashAt(42, 900, 2)).toBe(direct);
  });

  it('is sensitive to the seed', () => {
    const a = hashAt(1, 100, 0);
    const b = hashAt(2, 100, 0);
    expect(a).not.toBe(b);
  });
});

describe('randomAt', () => {
  it('stays within [0, 1)', () => {
    for (let i = 0; i < 20_000; i++) {
      const v = randomAt(7, i, i % 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const buckets: number[] = Array.from({ length: 10 }, () => 0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(randomAt(99, i, 0) * 10);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    for (const count of buckets) {
      // Expected n/10 = 10000. A 10% band is loose enough never to flake and tight enough to
      // catch a genuinely broken generator.
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });

  it('has no correlation between consecutive ids', () => {
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += (randomAt(5, i, 0) - 0.5) * (randomAt(5, i + 1, 0) - 0.5);
    expect(Math.abs(sum / n)).toBeLessThan(0.005);
  });
});

describe('derived distributions', () => {
  it('uniformAt respects its bounds', () => {
    for (let i = 0; i < 5000; i++) {
      const v = uniformAt(3, i, 1, -2.5, 7.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(7.5);
    }
  });

  it('jitterAt is symmetric about zero', () => {
    let sum = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) sum += jitterAt(11, i, 0, 0.1);
    expect(Math.abs(sum / n)).toBeLessThan(0.002);
  });

  it('boolAt is a fair coin', () => {
    let heads = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) if (boolAt(13, i, 0)) heads++;
    expect(heads / n).toBeGreaterThan(0.48);
    expect(heads / n).toBeLessThan(0.52);
  });

  it('intAt stays in range and never returns n', () => {
    for (let i = 0; i < 10_000; i++) {
      const v = intAt(17, i, 0, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('intAt degrades safely for non-positive n', () => {
    expect(intAt(1, 1, 1, 0)).toBe(0);
    expect(intAt(1, 1, 1, -5)).toBe(0);
  });
});

describe('Rng stream', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let sameCount = 0;
    for (let i = 0; i < 50; i++) if (a.next() === b.next()) sameCount++;
    expect(sameCount).toBe(0);
  });

  it('shuffle is a permutation', () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const shuffled = new Rng(9).shuffle([...items]);
    expect(shuffled).toHaveLength(200);
    expect(shuffled.toSorted((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('shuffle is deterministic for a given seed', () => {
    const a = new Rng(77).shuffle(Array.from({ length: 50 }, (_, i) => i));
    const b = new Rng(77).shuffle(Array.from({ length: 50 }, (_, i) => i));
    expect(a).toEqual(b);
  });

  it('uniform, int and bool respect their contracts', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 2000; i++) {
      const u = rng.uniform(10, 20);
      expect(u).toBeGreaterThanOrEqual(10);
      expect(u).toBeLessThan(20);
      const n = rng.int(4);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
      expect(typeof rng.bool()).toBe('boolean');
    }
    expect(rng.int(0)).toBe(0);
  });
});

describe('seedFromString', () => {
  it('is deterministic and well distributed', () => {
    expect(seedFromString('hexforge')).toBe(seedFromString('hexforge'));
    expect(seedFromString('hexforge')).not.toBe(seedFromString('hexforgf'));
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(seedFromString(`seed-${i}`));
    expect(seen.size).toBe(5000);
  });

  it('handles the empty string', () => {
    expect(Number.isInteger(seedFromString(''))).toBe(true);
  });
});
