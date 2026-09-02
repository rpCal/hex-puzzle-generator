import { describe, it, expect } from 'vitest';
import {
  SQRT3,
  axial,
  axialEquals,
  DIRECTIONS,
  oppositeEdge,
  neighbor,
  neighbors,
  axialDistance,
  ringOf,
  pieceCount,
  hexBoard,
  rectBoard,
  HexLayout,
  axialRound,
  axialKey,
  axialFromKey,
  axialCompare,
  axialLess,
} from '@core/math/hex.ts';
import { distance, equals as vecEquals } from '@core/math/vec2.ts';

const R = 52; // the original's radius, kept as the canonical test value

describe('layout constants', () => {
  const layout = new HexLayout(R);

  it('matches the inherited formulas h = R*sqrt(3)/2, hs = 2h, vs = 1.5R', () => {
    expect(layout.inradius).toBeCloseTo((R * SQRT3) / 2, 12);
    expect(layout.pitchX).toBeCloseTo(2 * layout.inradius, 12);
    expect(layout.pitchX).toBeCloseTo(R * SQRT3, 12);
    expect(layout.pitchY).toBeCloseTo(1.5 * R, 12);
  });

  it('rejects a non-positive radius rather than producing NaN geometry', () => {
    expect(() => new HexLayout(0)).toThrow(RangeError);
    expect(() => new HexLayout(-1)).toThrow(RangeError);
    expect(() => new HexLayout(NaN)).toThrow(RangeError);
  });

  it('places neighbouring centres exactly R*sqrt(3) apart', () => {
    const origin = axial(0, 0);
    for (let k = 0; k < 6; k++) {
      const d = distance(layout.center(origin), layout.center(neighbor(origin, k)));
      expect(d).toBeCloseTo(R * SQRT3, 9);
    }
  });

  it('puts every vertex exactly R from its centre', () => {
    const a = axial(2, -3);
    const c = layout.center(a);
    for (let k = 0; k < 6; k++) {
      expect(distance(c, layout.vertex(a, k))).toBeCloseTo(R, 9);
    }
  });

  it('is pointy-top: vertex 0 sits directly below the centre in y-down space', () => {
    const c = layout.center(axial(0, 0));
    const v0 = layout.vertex(axial(0, 0), 0);
    expect(v0.x).toBeCloseTo(c.x, 9);
    expect(v0.y).toBeCloseTo(c.y + R, 9);
  });

  it('corners() returns six distinct vertices in vertex order', () => {
    const a = axial(1, 1);
    const cs = layout.corners(a);
    expect(cs).toHaveLength(6);
    for (let k = 0; k < 6; k++) expect(vecEquals(cs[k]!, layout.vertex(a, k), 1e-9)).toBe(true);
  });
});

describe('directions and edges', () => {
  it('has six unique directions', () => {
    const keys = new Set(DIRECTIONS.map((d) => `${d.q},${d.r}`));
    expect(keys.size).toBe(6);
  });

  it('directions sum to zero, so the board has no drift', () => {
    const sum = DIRECTIONS.reduce((acc, d) => ({ q: acc.q + d.q, r: acc.r + d.r }), { q: 0, r: 0 });
    expect(sum).toEqual({ q: 0, r: 0 });
  });

  it('oppositeEdge is an involution', () => {
    for (let k = 0; k < 6; k++) expect(oppositeEdge(oppositeEdge(k))).toBe(k);
  });

  it('crossing edge k and then edge k+3 returns to the start', () => {
    const a = axial(3, -1);
    for (let k = 0; k < 6; k++) {
      expect(axialEquals(neighbor(neighbor(a, k), oppositeEdge(k)), a)).toBe(true);
    }
  });

  it('normalises out-of-range edge indices', () => {
    const a = axial(0, 0);
    expect(neighbor(a, 6)).toEqual(neighbor(a, 0));
    expect(neighbor(a, -1)).toEqual(neighbor(a, 5));
  });

  it('neighbors() agrees with neighbor()', () => {
    const a = axial(-2, 4);
    const list = neighbors(a);
    for (let k = 0; k < 6; k++) expect(list[k]).toEqual(neighbor(a, k));
  });

  it('every neighbour is at hex distance 1', () => {
    const a = axial(5, -2);
    for (const n of neighbors(a)) expect(axialDistance(a, n)).toBe(1);
  });

  /**
   * The interlock invariant, and the single most important geometric fact in the project.
   *
   * Edge k of hex H runs from H's vertex k to vertex k+1. The same physical edge, seen from the
   * neighbour across it, is that neighbour's edge k+3 running from its vertex k+3 to k+4. For the
   * two pieces to interlock, those must be the *same two points in the opposite order* — because
   * the cut generator will then be able to generate one curve and hand the reversal to the
   * neighbour, guaranteeing the tab of one is exactly the blank of the other.
   */
  it('edge k of H and edge k+3 of its neighbour are the same two vertices, reversed', () => {
    const layout = new HexLayout(R);
    for (const h of hexBoard(2)) {
      for (let k = 0; k < 6; k++) {
        const n = neighbor(h, k);
        const ours = [layout.vertex(h, k), layout.vertex(h, k + 1)] as const;
        const theirs = [
          layout.vertex(n, oppositeEdge(k)),
          layout.vertex(n, oppositeEdge(k) + 1),
        ] as const;
        expect(vecEquals(ours[0], theirs[1], 1e-9)).toBe(true);
        expect(vecEquals(ours[1], theirs[0], 1e-9)).toBe(true);
      }
    }
  });
});

describe('board enumeration', () => {
  it('pieceCount follows 3n^2 + 3n + 1', () => {
    expect(pieceCount(0)).toBe(1);
    expect(pieceCount(1)).toBe(7);
    expect(pieceCount(2)).toBe(19);
    expect(pieceCount(3)).toBe(37);
    expect(pieceCount(5)).toBe(91);
    expect(pieceCount(8)).toBe(217);
    expect(pieceCount(12)).toBe(469);
    expect(pieceCount(18)).toBe(1027);
  });

  it('hexBoard produces exactly pieceCount(n) unique hexes', () => {
    for (let n = 0; n <= 8; n++) {
      const board = hexBoard(n);
      expect(board).toHaveLength(pieceCount(n));
      expect(new Set(board.map(axialKey)).size).toBe(pieceCount(n));
    }
  });

  it('every hex on the board is within n rings, and every hex within n rings is on it', () => {
    const n = 4;
    const board = hexBoard(n);
    for (const h of board) expect(ringOf(h)).toBeLessThanOrEqual(n);

    const present = new Set(board.map(axialKey));
    for (let q = -n * 2; q <= n * 2; q++) {
      for (let r = -n * 2; r <= n * 2; r++) {
        const inRings = ringOf(axial(q, r)) <= n;
        expect(present.has(axialKey(axial(q, r)))).toBe(inRings);
      }
    }
  });

  it('is enumerated in a stable order', () => {
    expect(hexBoard(3).map(axialKey)).toEqual(hexBoard(3).map(axialKey));
  });

  it('ring counts are 1, 6, 12, 18, ...', () => {
    const counts = new Map<number, number>();
    for (const h of hexBoard(5)) counts.set(ringOf(h), (counts.get(ringOf(h)) ?? 0) + 1);
    expect(counts.get(0)).toBe(1);
    for (let ring = 1; ring <= 5; ring++) expect(counts.get(ring)).toBe(6 * ring);
  });

  it('the board is connected: every non-centre hex has a neighbour closer to the centre', () => {
    const board = hexBoard(4);
    const present = new Set(board.map(axialKey));
    for (const h of board) {
      if (ringOf(h) === 0) continue;
      const closer = neighbors(h).filter((n) => present.has(axialKey(n)) && ringOf(n) < ringOf(h));
      expect(closer.length).toBeGreaterThan(0);
    }
  });

  it('rectBoard produces cols*rows unique hexes', () => {
    const board = rectBoard(7, 5);
    expect(board).toHaveLength(35);
    expect(new Set(board.map(axialKey)).size).toBe(35);
  });

  it('rectBoard rows stay horizontally aligned', () => {
    const layout = new HexLayout(R);
    const board = rectBoard(6, 4);
    const byRow = new Map<number, number[]>();
    for (const h of board) {
      const xs = byRow.get(h.r) ?? [];
      xs.push(layout.center(h).x);
      byRow.set(h.r, xs);
    }
    // Each row spans the same width; only the half-pitch stagger differs.
    const spans = [...byRow.values()].map((xs) => Math.max(...xs) - Math.min(...xs));
    for (const s of spans) expect(s).toBeCloseTo(spans[0]!, 6);
  });
});

describe('axial <-> pixel round trips', () => {
  const layout = new HexLayout(R);

  it('centre of a hex maps back to that hex', () => {
    for (const h of hexBoard(6)) {
      expect(layout.toAxial(layout.center(h))).toEqual(h);
    }
  });

  it('points near a centre still map to that hex', () => {
    // Anything strictly inside the inradius is unambiguously inside the hex.
    const inset = layout.inradius * 0.9;
    for (const h of hexBoard(3)) {
      const c = layout.center(h);
      for (const [dx, dy] of [
        [inset, 0],
        [-inset, 0],
        [0, inset],
        [0, -inset],
      ] as const) {
        expect(layout.toAxial({ x: c.x + dx, y: c.y + dy })).toEqual(h);
      }
    }
  });

  it('toFractionalAxial is the exact inverse of center', () => {
    for (const h of hexBoard(4)) {
      const f = layout.toFractionalAxial(layout.center(h));
      expect(f.q).toBeCloseTo(h.q, 9);
      expect(f.r).toBeCloseTo(h.r, 9);
    }
  });

  it('axialRound always returns integers on the cube plane', () => {
    for (let i = 0; i < 2000; i++) {
      const qf = (i * 0.317) % 11 - 5;
      const rf = (i * 0.713) % 13 - 6;
      const a = axialRound(qf, rf);
      expect(Number.isInteger(a.q)).toBe(true);
      expect(Number.isInteger(a.r)).toBe(true);
      // The rounded hex must be one of the candidates adjacent to the fractional point.
      expect(Math.abs(a.q - qf) + Math.abs(a.r - rf)).toBeLessThan(2);
    }
  });
});

describe('keys and ordering', () => {
  it('axialKey round-trips over the supported range', () => {
    for (const q of [-1000, -1, 0, 1, 1000]) {
      for (const r of [-1000, -1, 0, 1, 1000]) {
        expect(axialFromKey(axialKey(axial(q, r)))).toEqual(axial(q, r));
      }
    }
  });

  it('axialKey is collision-free across a whole board', () => {
    const board = hexBoard(20);
    expect(new Set(board.map(axialKey)).size).toBe(board.length);
  });

  it('axialCompare is a strict total order', () => {
    const board = hexBoard(3);
    for (const a of board) {
      expect(axialCompare(a, a)).toBe(0);
      for (const b of board) {
        if (axialEquals(a, b)) continue;
        expect(Math.sign(axialCompare(a, b))).toBe(-Math.sign(axialCompare(b, a)));
        expect(axialLess(a, b) !== axialLess(b, a)).toBe(true);
      }
    }
  });

  it('exactly one of any neighbouring pair owns their shared edge', () => {
    for (const h of hexBoard(3)) {
      for (const n of neighbors(h)) {
        expect(axialLess(h, n) !== axialLess(n, h)).toBe(true);
      }
    }
  });
});

describe('axialDistance', () => {
  it('is zero only for identical hexes and symmetric otherwise', () => {
    const board = hexBoard(3);
    for (const a of board) {
      expect(axialDistance(a, a)).toBe(0);
      for (const b of board) {
        expect(axialDistance(a, b)).toBe(axialDistance(b, a));
        if (!axialEquals(a, b)) expect(axialDistance(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it('agrees with ringOf when measured from the origin', () => {
    for (const h of hexBoard(5)) expect(axialDistance(axial(0, 0), h)).toBe(ringOf(h));
  });

  it('satisfies the triangle inequality', () => {
    const board = hexBoard(2);
    for (const a of board)
      for (const b of board)
        for (const c of board)
          expect(axialDistance(a, c)).toBeLessThanOrEqual(axialDistance(a, b) + axialDistance(b, c));
  });
});
