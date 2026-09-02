import type { Vec2 } from '../math/vec2.ts';
import { cubic, type Cubic } from '../math/bezier.ts';
import { boolAt, jitterAt } from '../rng/hash32.ts';

/**
 * The jigsaw tab curve.
 *
 * The ten-control-point parameterisation is adopted from the CC0 SVG jigsaw generator surveyed
 * during research (docs/RESEARCH.md §3). It is worth adopting because it is the reason a machine-cut
 * puzzle looks hand-made: the tab is not a circle on a stick, it is a neck that pinches before it
 * bulges, and every control point carries independent jitter.
 *
 * Everything is authored in **edge-local space**: `l` runs 0 -> 1 from the edge's start vertex to
 * its end vertex, and `w` is perpendicular displacement measured in units of edge length. That
 * makes the curve independent of the edge's length, orientation and position, which in turn is what
 * lets a neighbouring piece borrow the identical curve reversed.
 */

export interface TabParams {
  /** Tab size, as a fraction of edge length. Larger = fatter, easier to grip visually. */
  readonly tabSize: number;
  /** Jitter magnitude. Larger = less regular, harder puzzle. */
  readonly jitter: number;
}

/** Per-edge randomness, drawn once from the counter-based hash. */
export interface EdgeJitter {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  /** Which side the tab bulges toward. */
  readonly flip: boolean;
}

/** Channel indices within an edge's slice of the hash space. Six channels, eight reserved. */
const enum Ch {
  A = 0,
  B = 1,
  C = 2,
  D = 3,
  E = 4,
  Flip = 5,
}

/** Channels reserved per edge, so `edgeIndex * CHANNELS_PER_EDGE + channel` never collides. */
export const CHANNELS_PER_EDGE = 8;

/**
 * Draw an edge's jitter from the hash.
 *
 * `ownerKey` identifies the hex that owns the edge and `edgeIndex` which of its six edges. Both
 * sides of a shared edge resolve to the same owner (see `cut/edges.ts`), so both compute identical
 * parameters without communicating.
 */
export function edgeJitter(
  seed: number,
  ownerKey: number,
  edgeIndex: number,
  params: TabParams,
): EdgeJitter {
  const base = edgeIndex * CHANNELS_PER_EDGE;
  const j = params.jitter;
  return {
    a: jitterAt(seed, ownerKey, base + Ch.A, j),
    b: jitterAt(seed, ownerKey, base + Ch.B, j),
    c: jitterAt(seed, ownerKey, base + Ch.C, j),
    d: jitterAt(seed, ownerKey, base + Ch.D, j),
    e: jitterAt(seed, ownerKey, base + Ch.E, j),
    flip: boolAt(seed, ownerKey, base + Ch.Flip),
  };
}

/** The ten control points in edge-local `(l, w)` space. */
export function tabControlPoints(params: TabParams, j: EdgeJitter): Vec2[] {
  const t = params.tabSize;
  const { a, b, c, d, e } = j;
  const s = j.flip ? -1 : 1;
  const w = (v: number): number => v * s;

  return [
    { x: 0, y: w(0) },
    { x: 0.2, y: w(a) },
    { x: 0.5 + b + d, y: w(-t + c) },
    { x: 0.5 - t + b, y: w(t + c) },
    { x: 0.5 - 2 * t + b - d, y: w(3 * t + c) },
    { x: 0.5 + 2 * t + b - d, y: w(3 * t + c) },
    { x: 0.5 + t + b, y: w(t + c) },
    { x: 0.5 + b + d, y: w(-t + c) },
    { x: 0.8, y: w(e) },
    { x: 1, y: w(0) },
  ];
}

/**
 * Map an edge-local point into board space.
 *
 * `w` is scaled by edge length too, not just `l`. That is deliberate: it keeps the tab's proportions
 * constant regardless of piece size, so zooming the board or changing the difficulty's radius never
 * changes the shape of the cut, only its scale.
 */
function toBoard(from: Vec2, to: Vec2, local: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular is (-dy, dx); combined with the unscaled (dx, dy) this maps the unit edge-local
  // frame onto the edge directly, with no normalisation and no length term needed.
  return {
    x: from.x + dx * local.x - dy * local.y,
    y: from.y + dy * local.x + dx * local.y,
  };
}

/**
 * The three cubic segments of a tabbed edge, running from `from` to `to`.
 *
 * Consecutive control points are grouped `p0p1p2p3`, `p3p4p5p6`, `p6p7p8p9` — so the chain is
 * continuous by construction and `p3`/`p6` are shared join points.
 */
export function tabbedEdge(from: Vec2, to: Vec2, params: TabParams, j: EdgeJitter): Cubic[] {
  const p = tabControlPoints(params, j).map((local) => toBoard(from, to, local));
  return [
    cubic(p[0] as Vec2, p[1] as Vec2, p[2] as Vec2, p[3] as Vec2),
    cubic(p[3] as Vec2, p[4] as Vec2, p[5] as Vec2, p[6] as Vec2),
    cubic(p[6] as Vec2, p[7] as Vec2, p[8] as Vec2, p[9] as Vec2),
  ];
}

/**
 * A straight edge, as a single cubic with control points at the thirds.
 *
 * Used for the board's outer boundary, which must stay straight — a tab there would have nothing to
 * interlock with. Kept as a cubic rather than a special-cased line so every edge in the board has
 * the same representation and the SVG export needs no branch.
 */
export function straightEdge(from: Vec2, to: Vec2): Cubic[] {
  const lerp = (t: number): Vec2 => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  });
  return [cubic(from, lerp(1 / 3), lerp(2 / 3), to)];
}
