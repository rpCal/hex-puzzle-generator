import type { Vec2 } from './vec2.ts';

/**
 * Cubic Bézier evaluation and adaptive flattening.
 *
 * The cut is authored as Béziers because that is what makes it look hand-made, and it is exported
 * to SVG as Béziers at full precision. But the GPU evaluates the piece silhouette as a signed
 * distance field, and exact cubic-Bézier SDF is far too expensive per fragment — so the same curves
 * are flattened to line segments once, on the CPU, at generation time. `flatten` is the bridge
 * between those two representations, and its error bound is what guarantees the rendered silhouette
 * matches the printed one.
 */

export interface Cubic {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
}

export const cubic = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Cubic => ({ p0, p1, p2, p3 });

/** Point on the curve at `t in [0, 1]`. */
export function evaluate(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const w0 = uu * u;
  const w1 = 3 * uu * t;
  const w2 = 3 * u * tt;
  const w3 = tt * t;
  return {
    x: w0 * c.p0.x + w1 * c.p1.x + w2 * c.p2.x + w3 * c.p3.x,
    y: w0 * c.p0.y + w1 * c.p1.y + w2 * c.p2.y + w3 * c.p3.y,
  };
}

/** First derivative at `t`. Zero-length results are possible at cusps; callers must not assume otherwise. */
export function derivative(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const w0 = 3 * u * u;
  const w1 = 6 * u * t;
  const w2 = 3 * t * t;
  return {
    x: w0 * (c.p1.x - c.p0.x) + w1 * (c.p2.x - c.p1.x) + w2 * (c.p3.x - c.p2.x),
    y: w0 * (c.p1.y - c.p0.y) + w1 * (c.p2.y - c.p1.y) + w2 * (c.p3.y - c.p2.y),
  };
}

/** Reverse parameterisation. `reverse(c)` traces the same points from p3 to p0. */
export const reverse = (c: Cubic): Cubic => ({ p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 });

/**
 * Number of uniform segments needed to approximate `c` within `tolerance`.
 *
 * Uses the standard bound on the deviation of a cubic from its chord: with
 * `L = max(|p0 - 2p1 + p2|, |p1 - 2p2 + p3|)` (the largest second difference), the error of an
 * `n`-segment uniform subdivision is at most `3L / (4n^2)`. Solving for the error gives the count
 * below. Clamped to `[1, 64]` — a single cut edge never legitimately needs more than 64 segments,
 * and refusing to loop forever on a degenerate curve matters more than the last micron.
 */
export function segmentsFor(c: Cubic, tolerance: number): number {
  const d1x = c.p0.x - 2 * c.p1.x + c.p2.x;
  const d1y = c.p0.y - 2 * c.p1.y + c.p2.y;
  const d2x = c.p1.x - 2 * c.p2.x + c.p3.x;
  const d2y = c.p1.y - 2 * c.p2.y + c.p3.y;
  const l = Math.sqrt(Math.max(d1x * d1x + d1y * d1y, d2x * d2x + d2y * d2y));
  if (!(l > 0) || !(tolerance > 0)) return 1;
  const n = Math.ceil(Math.sqrt((3 * l) / (4 * tolerance)));
  return Math.min(64, Math.max(1, n));
}

/**
 * Flatten to a polyline within `tolerance`.
 *
 * `includeStart` exists because a piece boundary is a chain of curves: emitting `p0` for every
 * segment would duplicate every join. The chain emits the first point once, then appends.
 */
export function flatten(c: Cubic, tolerance: number, includeStart = true): Vec2[] {
  const n = segmentsFor(c, tolerance);
  const out: Vec2[] = [];
  if (includeStart) out.push(c.p0);
  for (let i = 1; i <= n; i++) out.push(evaluate(c, i / n));
  return out;
}

/**
 * Flatten a chain of curves into a single polyline, emitting each join exactly once.
 *
 * The chain is assumed continuous (`curves[i].p3 === curves[i+1].p0`), which the cut generator
 * guarantees by construction.
 */
export function flattenChain(curves: readonly Cubic[], tolerance: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i] as Cubic;
    const pts = flatten(c, tolerance, i === 0);
    for (const p of pts) out.push(p);
  }
  return out;
}

/**
 * Conservative bounding box: the convex hull of the control points contains the curve, so the
 * control-point AABB does too. Cheap and correct; used for the per-piece bounding circle that gives
 * the SDF shader its early-out.
 */
export function controlBounds(c: Cubic): { min: Vec2; max: Vec2 } {
  const xs = [c.p0.x, c.p1.x, c.p2.x, c.p3.x];
  const ys = [c.p0.y, c.p1.y, c.p2.y, c.p3.y];
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}

/** Approximate arc length by flattening. Used for the print export's legend, not for anything hot. */
export function arcLength(c: Cubic, tolerance = 0.01): number {
  const pts = flatten(c, tolerance);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Split at `t`, returning the two sub-curves. de Casteljau. */
export function split(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(c.p0, c.p1);
  const p12 = lerp(c.p1, c.p2);
  const p23 = lerp(c.p2, c.p3);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  return [
    { p0: c.p0, p1: p01, p2: p012, p3: mid },
    { p0: mid, p1: p123, p2: p23, p3: c.p3 },
  ];
}
