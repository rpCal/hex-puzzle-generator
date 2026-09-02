import { describe, it, expect } from 'vitest';
import {
  cubic,
  evaluate,
  derivative,
  reverse,
  segmentsFor,
  flatten,
  flattenChain,
  controlBounds,
  arcLength,
  split,
} from '@core/math/bezier.ts';
import { vec2, distance, type Vec2 } from '@core/math/vec2.ts';

const LINE = cubic(vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(3, 0));
const ARC = cubic(vec2(0, 0), vec2(0, 10), vec2(10, 10), vec2(10, 0));
const WIGGLE = cubic(vec2(0, 0), vec2(3, 12), vec2(7, -12), vec2(10, 0));

/** Ground truth: distance from a point to the curve, by dense sampling. */
function distanceToCurve(c: typeof ARC, p: Vec2, samples = 20_000): number {
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const d = distance(evaluate(c, i / samples), p);
    if (d < best) best = d;
  }
  return best;
}

describe('evaluate', () => {
  it('interpolates the endpoints exactly', () => {
    for (const c of [LINE, ARC, WIGGLE]) {
      expect(evaluate(c, 0)).toEqual(c.p0);
      const end = evaluate(c, 1);
      expect(end.x).toBeCloseTo(c.p3.x, 12);
      expect(end.y).toBeCloseTo(c.p3.y, 12);
    }
  });

  it('reproduces a straight line for collinear evenly spaced control points', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const p = evaluate(LINE, t);
      expect(p.x).toBeCloseTo(3 * t, 9);
      expect(p.y).toBeCloseTo(0, 12);
    }
  });

  it('is symmetric for a symmetric curve', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = evaluate(ARC, t);
      const b = evaluate(ARC, 1 - t);
      expect(a.x).toBeCloseTo(10 - b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
    }
  });
});

describe('derivative', () => {
  it('matches a numerical derivative', () => {
    const h = 1e-6;
    for (const c of [ARC, WIGGLE]) {
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const a = evaluate(c, t - h);
        const b = evaluate(c, t + h);
        const numeric = { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
        const analytic = derivative(c, t);
        expect(analytic.x).toBeCloseTo(numeric.x, 4);
        expect(analytic.y).toBeCloseTo(numeric.y, 4);
      }
    }
  });

  it('points along the first control leg at t=0', () => {
    const d = derivative(ARC, 0);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(30, 9);
  });
});

describe('reverse', () => {
  it('traces the same points in the opposite parameterisation', () => {
    // This is the operation that lets a neighbour borrow a shared cut edge. If it were not exact,
    // pieces would not interlock.
    const r = reverse(WIGGLE);
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const a = evaluate(WIGGLE, t);
      const b = evaluate(r, 1 - t);
      expect(distance(a, b)).toBeLessThan(1e-12);
    }
  });

  it('is an involution', () => {
    expect(reverse(reverse(WIGGLE))).toEqual(WIGGLE);
  });
});

describe('segmentsFor', () => {
  it('needs a single segment for a straight line', () => {
    expect(segmentsFor(LINE, 0.01)).toBe(1);
  });

  it('increases as the tolerance tightens', () => {
    const loose = segmentsFor(WIGGLE, 1);
    const tight = segmentsFor(WIGGLE, 0.001);
    expect(tight).toBeGreaterThan(loose);
  });

  it('is clamped to [1, 64] so a degenerate curve cannot hang the generator', () => {
    expect(segmentsFor(WIGGLE, 1e-12)).toBe(64);
    expect(segmentsFor(WIGGLE, 0)).toBe(1);
    expect(segmentsFor(WIGGLE, -1)).toBe(1);
  });
});

describe('flatten', () => {
  it('starts at p0 and ends at p3', () => {
    const pts = flatten(ARC, 0.01);
    expect(pts[0]).toEqual(ARC.p0);
    const last = pts.at(-1)!;
    expect(last.x).toBeCloseTo(ARC.p3.x, 9);
    expect(last.y).toBeCloseTo(ARC.p3.y, 9);
  });

  it('omits the start point when asked, for chaining', () => {
    const withStart = flatten(ARC, 0.01, true);
    const without = flatten(ARC, 0.01, false);
    expect(without).toHaveLength(withStart.length - 1);
    expect(without[0]).toEqual(withStart[1]);
  });

  /**
   * The contract that matters: the polyline the GPU rasterises must not visibly diverge from the
   * Bezier the SVG export prints. Verified by measuring the true distance from each polyline
   * midpoint to the curve.
   */
  it('stays within the requested tolerance of the true curve', () => {
    for (const tolerance of [0.5, 0.1, 0.02]) {
      for (const c of [ARC, WIGGLE]) {
        const pts = flatten(c, tolerance);
        for (let i = 1; i < pts.length; i++) {
          const mid = {
            x: (pts[i - 1]!.x + pts[i]!.x) / 2,
            y: (pts[i - 1]!.y + pts[i]!.y) / 2,
          };
          expect(distanceToCurve(c, mid, 5000)).toBeLessThanOrEqual(tolerance);
        }
      }
    }
  });

  it('produces monotonically finer polylines as tolerance tightens', () => {
    const counts = [1, 0.25, 0.05, 0.01].map((tol) => flatten(WIGGLE, tol).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });
});

describe('flattenChain', () => {
  it('emits each join exactly once', () => {
    const [a, b] = split(ARC, 0.4);
    const chained = flattenChain([a, b], 0.05);
    const separate = flatten(a, 0.05).length + flatten(b, 0.05).length;
    expect(chained).toHaveLength(separate - 1);
  });

  it('reproduces the original curve when split and rejoined', () => {
    const [a, b] = split(WIGGLE, 0.63);
    for (const p of flattenChain([a, b], 0.01)) {
      expect(distanceToCurve(WIGGLE, p, 5000)).toBeLessThan(0.02);
    }
  });

  it('returns an empty polyline for an empty chain', () => {
    expect(flattenChain([], 0.1)).toEqual([]);
  });
});

describe('split', () => {
  it('preserves the curve exactly', () => {
    const [a, b] = split(WIGGLE, 0.37);
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      expect(distance(evaluate(a, t), evaluate(WIGGLE, t * 0.37))).toBeLessThan(1e-9);
      expect(distance(evaluate(b, t), evaluate(WIGGLE, 0.37 + t * 0.63))).toBeLessThan(1e-9);
    }
  });

  it('meets at the split point', () => {
    const [a, b] = split(ARC, 0.5);
    expect(distance(a.p3, b.p0)).toBe(0);
  });
});

describe('controlBounds', () => {
  it('contains the entire curve', () => {
    for (const c of [ARC, WIGGLE]) {
      const box = controlBounds(c);
      for (let i = 0; i <= 200; i++) {
        const p = evaluate(c, i / 200);
        expect(p.x).toBeGreaterThanOrEqual(box.min.x - 1e-9);
        expect(p.x).toBeLessThanOrEqual(box.max.x + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(box.min.y - 1e-9);
        expect(p.y).toBeLessThanOrEqual(box.max.y + 1e-9);
      }
    }
  });
});

describe('arcLength', () => {
  it('matches the exact length of a straight line', () => {
    expect(arcLength(LINE)).toBeCloseTo(3, 6);
  });

  it('is at least the chord length and converges as tolerance tightens', () => {
    const chord = distance(ARC.p0, ARC.p3);
    const coarse = arcLength(ARC, 1);
    const fine = arcLength(ARC, 0.001);
    expect(coarse).toBeGreaterThanOrEqual(chord);
    expect(fine).toBeGreaterThanOrEqual(coarse - 1e-9);
  });
});
