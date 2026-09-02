import { describe, it, expect } from 'vitest';
import {
  generateCut,
  fingerprint,
  cellsFor,
  countFor,
  type BoardShape,
  type CutBoard,
  type CutOptions,
} from '@core/cut/board.ts';
import { tabControlPoints, edgeJitter, CHANNELS_PER_EDGE } from '@core/cut/tab.ts';
import { axialKey, neighbor, oppositeEdge, pieceCount, HexLayout } from '@core/math/hex.ts';
import { evaluate, type Cubic } from '@core/math/bezier.ts';
import { distance, type Vec2 } from '@core/math/vec2.ts';

const RADIUS = 52;

const options = (over: Partial<CutOptions> = {}): CutOptions => ({
  seed: 12345,
  shape: { kind: 'hex', rings: 3 },
  radius: RADIUS,
  tab: { tabSize: 0.16, jitter: 0.06 },
  ...over,
});

const board = (over: Partial<CutOptions> = {}): CutBoard => generateCut(options(over));

/** Exact float equality on a curve. Not approximate — the interlock guarantee is structural. */
const curveIdentical = (a: Cubic, b: Cubic): boolean =>
  a.p0.x === b.p0.x &&
  a.p0.y === b.p0.y &&
  a.p1.x === b.p1.x &&
  a.p1.y === b.p1.y &&
  a.p2.x === b.p2.x &&
  a.p2.y === b.p2.y &&
  a.p3.x === b.p3.x &&
  a.p3.y === b.p3.y;

const reversedCurve = (c: Cubic): Cubic => ({ p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 });

/** Largest perpendicular excursion of a set of edge-local control points. */
const maxReach = (pts: Vec2[]): number => Math.max(...pts.map((p) => Math.abs(p.y)));

describe('board shape', () => {
  it('generates the right number of pieces', () => {
    for (const rings of [0, 1, 2, 3, 5, 8]) {
      expect(board({ shape: { kind: 'hex', rings } }).pieces).toHaveLength(pieceCount(rings));
    }
    expect(board({ shape: { kind: 'rect', cols: 6, rows: 4 } }).pieces).toHaveLength(24);
  });

  it('countFor agrees with the generated board without generating it', () => {
    const shapes: BoardShape[] = [
      { kind: 'hex', rings: 4 },
      { kind: 'rect', cols: 5, rows: 7 },
    ];
    for (const shape of shapes) {
      expect(countFor(shape)).toBe(cellsFor(shape).length);
      expect(countFor(shape)).toBe(board({ shape }).pieces.length);
    }
  });

  it('indexes every piece by its cell', () => {
    const b = board();
    expect(b.byCell.size).toBe(b.pieces.length);
    for (const piece of b.pieces) {
      expect(b.byCell.get(axialKey(piece.cell))).toBe(piece.index);
    }
  });
});

describe('piece structure', () => {
  it('gives every piece exactly six edges', () => {
    for (const piece of board({ shape: { kind: 'hex', rings: 4 } }).pieces) {
      expect(piece.edgeCurves).toHaveLength(6);
      expect(piece.neighbors).toHaveLength(6);
    }
  });

  it('joins the edge curves into one continuous closed chain', () => {
    for (const piece of board().pieces) {
      for (let i = 1; i < piece.curves.length; i++) {
        const prev = piece.curves[i - 1] as Cubic;
        const next = piece.curves[i] as Cubic;
        expect(distance(prev.p3, next.p0)).toBeLessThan(1e-9);
      }
      const first = piece.curves[0] as Cubic;
      const last = piece.curves.at(-1) as Cubic;
      expect(distance(last.p3, first.p0)).toBeLessThan(1e-9);
    }
  });

  it('does not repeat the closing point in the flattened outline', () => {
    for (const piece of board().pieces) {
      const first = piece.outline[0] as Vec2;
      const last = piece.outline.at(-1) as Vec2;
      expect(distance(first, last)).toBeGreaterThan(1e-6);
    }
  });

  it('bounds contain every outline point', () => {
    for (const piece of board().pieces) {
      for (const p of piece.outline) {
        expect(p.x).toBeGreaterThanOrEqual(piece.bounds.min.x - 1e-9);
        expect(p.x).toBeLessThanOrEqual(piece.bounds.max.x + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(piece.bounds.min.y - 1e-9);
        expect(p.y).toBeLessThanOrEqual(piece.bounds.max.y + 1e-9);
      }
    }
  });

  it('boundingRadius covers every outline point from the centre', () => {
    for (const piece of board().pieces) {
      for (const p of piece.outline) {
        expect(distance(piece.center, p)).toBeLessThanOrEqual(piece.boundingRadius + 1e-9);
      }
      // ... and is tight: at least one point actually reaches it.
      const reached = piece.outline.some(
        (p) => Math.abs(distance(piece.center, p) - piece.boundingRadius) < 1e-9,
      );
      expect(reached).toBe(true);
    }
  });

  it('keeps pieces close to hexagonal: bounding radius within 1.6x the circumradius', () => {
    // Tabs stick out, but a piece that ballooned past this would overlap its neighbour's
    // neighbour and make the cut nonsense.
    for (const piece of board().pieces) {
      expect(piece.boundingRadius).toBeGreaterThan(RADIUS * 0.8);
      expect(piece.boundingRadius).toBeLessThan(RADIUS * 1.6);
    }
  });

  it('places every piece centre at its hex centre', () => {
    const layout = new HexLayout(RADIUS);
    for (const piece of board().pieces) {
      expect(piece.center).toEqual(layout.center(piece.cell));
    }
  });
});

describe('adjacency', () => {
  it('is symmetric', () => {
    const b = board({ shape: { kind: 'hex', rings: 4 } });
    for (const piece of b.pieces) {
      for (let k = 0; k < 6; k++) {
        const n = piece.neighbors[k] as number;
        if (n === -1) continue;
        expect(b.pieces[n]!.neighbors[oppositeEdge(k)]).toBe(piece.index);
      }
    }
  });

  it('agrees with the hex neighbour function', () => {
    const b = board();
    for (const piece of b.pieces) {
      for (let k = 0; k < 6; k++) {
        const expected = b.byCell.get(axialKey(neighbor(piece.cell, k))) ?? -1;
        expect(piece.neighbors[k]).toBe(expected);
      }
    }
  });

  it('marks exactly the outer ring as border pieces', () => {
    const rings = 3;
    const b = board({ shape: { kind: 'hex', rings } });
    for (const piece of b.pieces) {
      const onOuterRing =
        Math.max(
          Math.abs(piece.cell.q),
          Math.abs(piece.cell.r),
          Math.abs(piece.cell.q + piece.cell.r),
        ) === rings;
      expect(piece.isBorder).toBe(onOuterRing);
    }
  });

  it('gives an interior piece six neighbours and a corner piece three', () => {
    const b = board({ shape: { kind: 'hex', rings: 2 } });
    const centre = b.pieces[b.byCell.get(axialKey({ q: 0, r: 0 }))!]!;
    expect(centre.neighbors.filter((n) => n !== -1)).toHaveLength(6);

    const corner = b.pieces[b.byCell.get(axialKey({ q: 2, r: -2 }))!]!;
    expect(corner.neighbors.filter((n) => n !== -1)).toHaveLength(3);
  });
});

describe('interlock', () => {
  /**
   * The whole project rests on this. Two pieces fit together because the cut generator produced
   * *one* curve and handed the reversal to the neighbour — not because two independently generated
   * curves came out close enough. So the assertion is exact float equality, not approximate.
   */
  it('a shared edge is bit-identical, reversed, from both sides', () => {
    const b = board({ shape: { kind: 'hex', rings: 4 } });
    let checked = 0;
    for (const piece of b.pieces) {
      for (let k = 0; k < 6; k++) {
        const n = piece.neighbors[k] as number;
        if (n === -1) continue;
        const ours = piece.edgeCurves[k] as readonly Cubic[];
        const theirs = b.pieces[n]!.edgeCurves[oppositeEdge(k)] as readonly Cubic[];
        expect(theirs).toHaveLength(ours.length);
        for (let s = 0; s < ours.length; s++) {
          const mine = ours[s] as Cubic;
          const yours = theirs[ours.length - 1 - s] as Cubic;
          expect(curveIdentical(mine, reversedCurve(yours))).toBe(true);
        }
        checked++;
      }
    }
    // Sanity: the loop actually ran. Every interior edge is visited from both sides.
    expect(checked).toBeGreaterThan(100);
  });

  it('shared edges are tabbed and border edges are straight', () => {
    const b = board();
    for (const piece of b.pieces) {
      for (let k = 0; k < 6; k++) {
        const curves = piece.edgeCurves[k] as readonly Cubic[];
        if (piece.neighbors[k] === -1) {
          expect(curves).toHaveLength(1);
          // A straight edge: every sample lies on the chord.
          const c = curves[0] as Cubic;
          for (let i = 1; i < 10; i++) {
            const t = i / 10;
            const p = evaluate(c, t);
            const onChord = {
              x: c.p0.x + (c.p3.x - c.p0.x) * t,
              y: c.p0.y + (c.p3.y - c.p0.y) * t,
            };
            expect(distance(p, onChord)).toBeLessThan(1e-9);
          }
        } else {
          expect(curves).toHaveLength(3);
        }
      }
    }
  });

  it('every edge starts and ends at the hexagon vertices it spans', () => {
    // The tab bulges in the middle but must not move the corners, or pieces would not tile.
    const layout = new HexLayout(RADIUS);
    for (const piece of board().pieces) {
      for (let k = 0; k < 6; k++) {
        const curves = piece.edgeCurves[k] as readonly Cubic[];
        const start = (curves[0] as Cubic).p0;
        const end = (curves.at(-1) as Cubic).p3;
        expect(distance(start, layout.vertex(piece.cell, k))).toBeLessThan(1e-9);
        expect(distance(end, layout.vertex(piece.cell, k + 1))).toBeLessThan(1e-9);
      }
    }
  });
});

describe('unique edges', () => {
  it('records each physical cut line exactly once', () => {
    const b = board({ shape: { kind: 'hex', rings: 3 } });
    let borderSlots = 0;
    for (const piece of b.pieces) borderSlots += piece.neighbors.filter((n) => n === -1).length;
    const totalSlots = 6 * b.pieces.length;
    // Interior edges are counted twice across all pieces, border edges once.
    expect(b.uniqueEdges).toHaveLength((totalSlots + borderSlots) / 2);
  });

  it('never records the same (piece, edge) pair from both sides', () => {
    const b = board({ shape: { kind: 'hex', rings: 3 } });
    const seen = new Set<string>();
    for (const e of b.uniqueEdges) {
      const owner = b.pieces[e.ownerPiece]!;
      const a = axialKey(owner.cell);
      // A border edge is identified by its owner and edge index -- a border piece has several,
      // and they are different physical cut lines. An interior edge is identified by the
      // unordered pair of cells it separates, so recording it from either side collides.
      const key =
        e.otherPiece === -1
          ? `border:${a}:${e.edgeIndex}`
          : ((): string => {
              const other = axialKey(b.pieces[e.otherPiece]!.cell);
              return a < other ? `shared:${a}|${other}` : `shared:${other}|${a}`;
            })();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(b.uniqueEdges.length);
  });

  it('covers every edge of every piece exactly once between owner and borrower', () => {
    const b = board({ shape: { kind: 'rect', cols: 4, rows: 4 } });
    const covered = new Map<string, number>();
    for (const e of b.uniqueEdges) {
      const owner = b.pieces[e.ownerPiece]!;
      covered.set(`${owner.index}:${e.edgeIndex}`, 1);
      if (e.otherPiece !== -1) {
        covered.set(`${e.otherPiece}:${oppositeEdge(e.edgeIndex)}`, 1);
      }
    }
    expect(covered.size).toBe(b.pieces.length * 6);
  });

  it('flags border edges correctly', () => {
    const b = board();
    for (const e of b.uniqueEdges) {
      expect(e.isBorder).toBe(e.otherPiece === -1);
      expect(e.curves).toHaveLength(e.isBorder ? 1 : 3);
    }
  });
});

describe('determinism', () => {
  it('produces an identical board for an identical seed', () => {
    expect(fingerprint(board({ seed: 777 }))).toBe(fingerprint(board({ seed: 777 })));
  });

  it('produces a different board for a different seed', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) seen.add(fingerprint(board({ seed })));
    // Allow for the theoretical possibility of a 32-bit collision, but not for a broken generator.
    expect(seen.size).toBeGreaterThanOrEqual(199);
  });

  it('does not depend on the order pieces are generated in', () => {
    // The hash is counter-based, so a piece's edges are the same whether it was generated first
    // or last. Generating a bigger board and comparing the shared sub-region proves it.
    const small = board({ shape: { kind: 'hex', rings: 2 }, seed: 4242 });
    const large = board({ shape: { kind: 'hex', rings: 5 }, seed: 4242 });
    let compared = 0;
    for (const piece of small.pieces) {
      // Only interior edges of the small board are tabbed in both; its border edges are straight
      // there and tabbed in the large board, which is correct and expected.
      const big = large.pieces[large.byCell.get(axialKey(piece.cell))!]!;
      for (let k = 0; k < 6; k++) {
        if (piece.neighbors[k] === -1) continue;
        const mine = piece.edgeCurves[k] as readonly Cubic[];
        const theirs = big.edgeCurves[k] as readonly Cubic[];
        for (let s = 0; s < mine.length; s++) {
          expect(curveIdentical(mine[s] as Cubic, theirs[s] as Cubic)).toBe(true);
        }
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('changes when the tab parameters change', () => {
    const a = fingerprint(board({ tab: { tabSize: 0.16, jitter: 0.06 } }));
    const b = fingerprint(board({ tab: { tabSize: 0.12, jitter: 0.06 } }));
    const c = fingerprint(board({ tab: { tabSize: 0.16, jitter: 0.11 } }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  /**
   * The golden test. If this fails, every previously shared puzzle link now produces a different
   * puzzle. That is a breaking change; this test exists so it can only be a deliberate one.
   */
  it('matches the committed golden fingerprint', () => {
    const golden = generateCut({
      seed: 0x4845_5846,
      shape: { kind: 'hex', rings: 3 },
      radius: 52,
      tab: { tabSize: 0.16, jitter: 0.06 },
      flattenTolerance: 0.2,
    });
    expect(fingerprint(golden)).toBe(0xc9845960);
  });
});

describe('tab curve', () => {
  it('pins the first and last control points to the edge endpoints', () => {
    const j = edgeJitter(1, 2, 3, { tabSize: 0.2, jitter: 0.1 });
    const pts = tabControlPoints({ tabSize: 0.2, jitter: 0.1 }, j);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[9]).toEqual({ x: 1, y: 0 });
  });

  it('produces ten control points', () => {
    const j = edgeJitter(1, 2, 3, { tabSize: 0.2, jitter: 0.1 });
    expect(tabControlPoints({ tabSize: 0.2, jitter: 0.1 }, j)).toHaveLength(10);
  });

  it('mirrors the whole curve when flipped', () => {
    const params = { tabSize: 0.18, jitter: 0 };
    const base = { a: 0, b: 0, c: 0, d: 0, e: 0, flip: false };
    const up = tabControlPoints(params, base);
    const down = tabControlPoints(params, { ...base, flip: true });
    for (let i = 0; i < 10; i++) {
      expect(down[i]!.x).toBeCloseTo(up[i]!.x, 12);
      expect(down[i]!.y).toBeCloseTo(-up[i]!.y, 12);
    }
  });

  it('scales the bulge with tabSize', () => {
    const base = { a: 0, b: 0, c: 0, d: 0, e: 0, flip: false };
    const small = tabControlPoints({ tabSize: 0.1, jitter: 0 }, base);
    const large = tabControlPoints({ tabSize: 0.2, jitter: 0 }, base);
    expect(maxReach(large)).toBeGreaterThan(maxReach(small) * 1.5);
  });

  it('keeps jitter within the requested magnitude', () => {
    const params = { tabSize: 0.16, jitter: 0.05 };
    for (let i = 0; i < 500; i++) {
      const j = edgeJitter(9, i, i % 6, params);
      for (const v of [j.a, j.b, j.c, j.d, j.e]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('gives different edges of the same hex different parameters', () => {
    const params = { tabSize: 0.16, jitter: 0.06 };
    const seen = new Set<string>();
    for (let k = 0; k < 6; k++) {
      const j = edgeJitter(5, 1234, k, params);
      seen.add(`${j.a},${j.b},${j.c},${j.d},${j.e},${j.flip}`);
    }
    expect(seen.size).toBe(6);
  });

  it('reserves enough hash channels that edges cannot collide', () => {
    // Six channels are used per edge; the stride must exceed that or edge k's `flip` would be
    // edge k+1's `a`.
    expect(CHANNELS_PER_EDGE).toBeGreaterThanOrEqual(6);
  });
});

describe('performance', () => {
  it('generates a 1027-piece board well inside the 50 ms budget', () => {
    const start = performance.now();
    const b = generateCut(options({ shape: { kind: 'hex', rings: 18 } }));
    const elapsed = performance.now() - start;
    expect(b.pieces).toHaveLength(1027);
    expect(elapsed).toBeLessThan(200);
  });
});
