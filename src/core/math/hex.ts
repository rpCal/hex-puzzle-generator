import type { Vec2 } from './vec2.ts';

/**
 * Pointy-top hexagons in axial coordinates.
 *
 * The layout constants are inherited from the 2018 original, which had them right:
 *
 *   inradius   h  = R * sqrt(3) / 2
 *   pitch x    hs = 2h = R * sqrt(3)
 *   pitch y    vs = 1.5 * R
 *   vertex k   at angle 60k + 90 degrees, radius R
 *
 * The `+90` phase is what makes it pointy-top: at k = 0 the vertex sits directly below the centre
 * in y-down space. Everything else in this file follows from those four lines.
 */

export const SQRT3 = Math.sqrt(3);

export interface Axial {
  readonly q: number;
  readonly r: number;
}

export const axial = (q: number, r: number): Axial => ({ q, r });

export const axialEquals = (a: Axial, b: Axial): boolean => a.q === b.q && a.r === b.r;

/**
 * Directions indexed so that **direction k is the neighbour across edge k**.
 *
 * Edge k runs from vertex k to vertex k+1 (see `vertex`), so this ordering is not arbitrary — it is
 * derived from the vertex phase. Starting at the SW edge and running anticlockwise in y-down space:
 *
 *   0 SW   1 W   2 NW   3 NE   4 E   5 SE
 *
 * The payoff is `oppositeEdge(k) === (k + 3) % 6` with no lookup table, and the guarantee that
 * hex `H`'s edge `k` and neighbour `H + DIRECTIONS[k]`'s edge `k+3` are the same two vertices in
 * opposite order. That identity is what makes two pieces interlock.
 */
export const DIRECTIONS: readonly Axial[] = [
  { q: -1, r: +1 }, // 0  SW
  { q: -1, r: 0 }, //  1  W
  { q: 0, r: -1 }, //  2  NW
  { q: +1, r: -1 }, // 3  NE
  { q: +1, r: 0 }, //  4  E
  { q: 0, r: +1 }, //  5  SE
];

/** The edge index the neighbour uses for the edge we call `edge`. */
export const oppositeEdge = (edge: number): number => (edge + 3) % 6;

export function neighbor(a: Axial, edge: number): Axial {
  const d = DIRECTIONS[((edge % 6) + 6) % 6] as Axial;
  return { q: a.q + d.q, r: a.r + d.r };
}

export function neighbors(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}

/** Hex distance in axial coordinates. */
export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Ring index of a hex around the origin: `max(|q|, |r|, |q+r|)`. */
export const ringOf = (a: Axial): number =>
  Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(a.q + a.r));

/**
 * Number of hexes in a hex-shaped board of `rings` rings: `3n^2 + 3n + 1`.
 *
 * A hex-of-hexes is used instead of the original's rectangle because it has no ragged edge — which
 * is exactly what forced the original's one hardcoded special case for dangling stubs on the last
 * row — and because the piece count has a clean closed form.
 */
export const pieceCount = (rings: number): number => 3 * rings * rings + 3 * rings + 1;

/** Every hex in a hex-shaped board of `rings` rings, in a stable order (row-major by r, then q). */
export function hexBoard(rings: number): Axial[] {
  const out: Axial[] = [];
  for (let r = -rings; r <= rings; r++) {
    const qMin = Math.max(-rings, -r - rings);
    const qMax = Math.min(rings, -r + rings);
    for (let q = qMin; q <= qMax; q++) out.push({ q, r });
  }
  return out;
}

/** Every hex in a rectangular board, `cols` x `rows`. Used by the print export, where paper is rectangular. */
export function rectBoard(cols: number, rows: number): Axial[] {
  const out: Axial[] = [];
  for (let r = 0; r < rows; r++) {
    const offset = -Math.floor(r / 2);
    for (let i = 0; i < cols; i++) out.push({ q: offset + i, r });
  }
  return out;
}

/** Geometry of a hex grid at a given circumradius. */
export class HexLayout {
  readonly radius: number;
  /** Inradius: centre to edge midpoint. `R * sqrt(3) / 2`. */
  readonly inradius: number;
  /** Horizontal distance between neighbouring centres in the same row. `R * sqrt(3)`. */
  readonly pitchX: number;
  /** Vertical distance between rows. `1.5 * R`. */
  readonly pitchY: number;

  constructor(radius: number) {
    if (!(radius > 0)) throw new RangeError(`hex radius must be > 0, got ${radius}`);
    this.radius = radius;
    this.inradius = (radius * SQRT3) / 2;
    this.pitchX = radius * SQRT3;
    this.pitchY = radius * 1.5;
  }

  /** Centre of hex `(q, r)` in board space. */
  center(a: Axial): Vec2 {
    return { x: this.pitchX * (a.q + a.r / 2), y: this.pitchY * a.r };
  }

  /** Vertex `k` of hex `a`, `k` taken mod 6. Angle `60k + 90` degrees. */
  vertex(a: Axial, k: number): Vec2 {
    const c = this.center(a);
    return this.vertexAround(c, k);
  }

  /** Vertex `k` of a hex whose centre is `c`. */
  vertexAround(c: Vec2, k: number): Vec2 {
    const angle = ((((k % 6) + 6) % 6) * 60 + 90) * (Math.PI / 180);
    return { x: c.x + Math.cos(angle) * this.radius, y: c.y + Math.sin(angle) * this.radius };
  }

  /** All six vertices of `a`, in order, starting at the bottom vertex. */
  corners(a: Axial): Vec2[] {
    const c = this.center(a);
    const out: Vec2[] = [];
    for (let k = 0; k < 6; k++) out.push(this.vertexAround(c, k));
    return out;
  }

  /** Board-space point to fractional axial coordinates. Inverse of `center`. */
  toFractionalAxial(p: Vec2): { q: number; r: number } {
    const r = p.y / this.pitchY;
    const q = p.x / this.pitchX - r / 2;
    return { q, r };
  }

  /** Board-space point to the hex containing it. */
  toAxial(p: Vec2): Axial {
    const f = this.toFractionalAxial(p);
    return axialRound(f.q, f.r);
  }
}

/** Round fractional axial coordinates to the nearest hex, via cube coordinates. */
export function axialRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);

  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);

  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;

  // `| 0` is not decoration: `Math.round(-0.2)` is `-0`, and a coordinate of `-0` compares unequal
  // to `0` under `Object.is` and `toEqual`, so it would silently break piece identity checks for
  // hexes on the negative side of an axis. Normalise it away at the only place it can be produced.
  // `s` is implied by q and r; nothing further to do when it absorbed the error.
  return { q: q | 0, r: r | 0 };
}

/**
 * A stable, collision-free integer key for a hex.
 *
 * Used as the `id` fed to the counter-based hash, so a hex's random parameters do not depend on the
 * order the board was enumerated in. Valid for |q|, |r| < 32768.
 */
export function axialKey(a: Axial): number {
  return (((a.q + 0x8000) & 0xffff) << 16) | ((a.r + 0x8000) & 0xffff);
}

export function axialFromKey(key: number): Axial {
  return { q: ((key >>> 16) & 0xffff) - 0x8000, r: (key & 0xffff) - 0x8000 };
}

/**
 * Total ordering on hexes. Used to decide which of two neighbours *owns* a shared edge: the smaller
 * one does. Deterministic and independent of enumeration order.
 */
export function axialCompare(a: Axial, b: Axial): number {
  return a.r !== b.r ? a.r - b.r : a.q - b.q;
}

export const axialLess = (a: Axial, b: Axial): boolean => axialCompare(a, b) < 0;
