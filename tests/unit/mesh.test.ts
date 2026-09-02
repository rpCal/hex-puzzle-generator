import { describe, it, expect } from 'vitest';
import { triangulate, offsetInward, signedArea2 } from '@core/cut/triangulate.ts';
import { buildBoardMesh, buildPieceStatics, FLOATS_PER_VERTEX } from '@core/cut/mesh.ts';
import { generateCut, type CutBoard } from '@core/cut/board.ts';
import { vec2, type Vec2 } from '@core/math/vec2.ts';

const SQUARE: Vec2[] = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];
/** An L, so there is a genuine reflex vertex to clip around. */
const L_SHAPE: Vec2[] = [
  vec2(0, 0),
  vec2(4, 0),
  vec2(4, 2),
  vec2(2, 2),
  vec2(2, 4),
  vec2(0, 4),
];
/** A blank-like feature: a neck narrower than the head it opens into, i.e. not star-shaped. */
const NOTCHED: Vec2[] = [
  vec2(0, 0),
  vec2(10, 0),
  vec2(10, 10),
  vec2(6, 10),
  vec2(6, 6),
  vec2(8, 6),
  vec2(8, 4),
  vec2(2, 4),
  vec2(2, 6),
  vec2(4, 6),
  vec2(4, 10),
  vec2(0, 10),
];

const polygonArea = (poly: readonly Vec2[]): number => Math.abs(signedArea2(poly)) / 2;

function triangleArea(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

function triangulatedArea(poly: readonly Vec2[], indices: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    total += triangleArea(
      poly[indices[i] as number] as Vec2,
      poly[indices[i + 1] as number] as Vec2,
      poly[indices[i + 2] as number] as Vec2,
    );
  }
  return total;
}

describe('signedArea2', () => {
  it('is positive for one winding and negative for the other', () => {
    expect(signedArea2(SQUARE)).toBeGreaterThan(0);
    expect(signedArea2(SQUARE.toReversed())).toBeLessThan(0);
  });

  it('equals twice the area', () => {
    expect(Math.abs(signedArea2(SQUARE)) / 2).toBe(16);
  });
});

describe('triangulate', () => {
  it('emits n-2 triangles for a convex polygon', () => {
    expect(triangulate(SQUARE)).toHaveLength(2 * 3);
    const hexagon = Array.from({ length: 6 }, (_, i) =>
      vec2(Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)),
    );
    expect(triangulate(hexagon)).toHaveLength(4 * 3);
  });

  it('emits n-2 triangles for a concave polygon too', () => {
    expect(triangulate(L_SHAPE)).toHaveLength(4 * 3);
    expect(triangulate(NOTCHED)).toHaveLength(10 * 3);
  });

  /**
   * The real correctness property: the triangles must cover exactly the polygon, no more and no
   * less. A fan from the centroid would fail this on `NOTCHED`, which is precisely why ear clipping
   * is used.
   */
  it('covers exactly the polygon area', () => {
    for (const poly of [SQUARE, L_SHAPE, NOTCHED]) {
      expect(triangulatedArea(poly, triangulate(poly))).toBeCloseTo(polygonArea(poly), 6);
    }
  });

  it('works regardless of input winding', () => {
    for (const poly of [L_SHAPE, NOTCHED]) {
      const reversed = poly.toReversed();
      expect(triangulatedArea(reversed, triangulate(reversed))).toBeCloseTo(polygonArea(poly), 6);
    }
  });

  it('only references vertices that exist', () => {
    for (const poly of [SQUARE, L_SHAPE, NOTCHED]) {
      for (const index of triangulate(poly)) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(poly.length);
      }
    }
  });

  it('never emits a degenerate triangle for well-formed input', () => {
    for (const poly of [SQUARE, L_SHAPE, NOTCHED]) {
      const indices = triangulate(poly);
      for (let i = 0; i < indices.length; i += 3) {
        expect(
          triangleArea(
            poly[indices[i] as number] as Vec2,
            poly[indices[i + 1] as number] as Vec2,
            poly[indices[i + 2] as number] as Vec2,
          ),
        ).toBeGreaterThan(1e-9);
      }
    }
  });

  it('returns nothing for degenerate input instead of throwing', () => {
    expect(triangulate([])).toHaveLength(0);
    expect(triangulate([vec2(0, 0)])).toHaveLength(0);
    expect(triangulate([vec2(0, 0), vec2(1, 1)])).toHaveLength(0);
  });

  it('terminates on a self-intersecting polygon', () => {
    // A bowtie is not a simple polygon. The requirement is that it returns, not that it is right.
    const bowtie = [vec2(0, 0), vec2(4, 4), vec2(4, 0), vec2(0, 4)];
    expect(() => triangulate(bowtie)).not.toThrow();
  });

  it('handles a real piece outline', () => {
    const board = generateCut({
      seed: 5150,
      shape: { kind: 'hex', rings: 2 },
      radius: 52,
      tab: { tabSize: 0.16, jitter: 0.06 },
    });
    for (const piece of board.pieces) {
      const indices = triangulate(piece.outline);
      expect(indices.length).toBe((piece.outline.length - 2) * 3);
      expect(triangulatedArea(piece.outline, indices)).toBeCloseTo(polygonArea(piece.outline), 4);
    }
  });
});

describe('offsetInward', () => {
  it('shrinks a convex polygon', () => {
    const inner = offsetInward(SQUARE, 1);
    expect(polygonArea(inner)).toBeLessThan(polygonArea(SQUARE));
    expect(polygonArea(inner)).toBeCloseTo(4, 6);
  });

  it('keeps the same vertex count and winding', () => {
    for (const poly of [SQUARE, L_SHAPE, NOTCHED]) {
      const inner = offsetInward(poly, 0.3);
      expect(inner).toHaveLength(poly.length);
      expect(Math.sign(signedArea2(inner))).toBe(Math.sign(signedArea2(poly)));
    }
  });

  it('moves every vertex inward, not outward', () => {
    const inner = offsetInward(SQUARE, 1);
    for (const p of inner) {
      expect(p.x).toBeGreaterThan(-1e-9);
      expect(p.x).toBeLessThan(4 + 1e-9);
      expect(p.y).toBeGreaterThan(-1e-9);
      expect(p.y).toBeLessThan(4 + 1e-9);
    }
  });

  it('shrinks a real piece outline without inverting it', () => {
    const board = generateCut({
      seed: 909,
      shape: { kind: 'hex', rings: 2 },
      radius: 52,
      tab: { tabSize: 0.16, jitter: 0.06 },
    });
    for (const piece of board.pieces) {
      const inner = offsetInward(piece.outline, 52 * 0.06);
      expect(Math.sign(signedArea2(inner))).toBe(Math.sign(signedArea2(piece.outline)));
      expect(polygonArea(inner)).toBeLessThan(polygonArea(piece.outline));
      expect(polygonArea(inner)).toBeGreaterThan(polygonArea(piece.outline) * 0.5);
    }
  });

  it('leaves degenerate input alone', () => {
    expect(offsetInward([vec2(0, 0), vec2(1, 1)], 1)).toHaveLength(2);
  });
});

describe('buildBoardMesh', () => {
  const board: CutBoard = generateCut({
    seed: 2718,
    shape: { kind: 'hex', rings: 2 },
    radius: 52,
    tab: { tabSize: 0.16, jitter: 0.06 },
  });
  const mesh = buildBoardMesh(board);

  it('produces two rings of vertices per piece', () => {
    let expected = 0;
    for (const piece of board.pieces) expected += piece.outline.length * 2;
    expect(mesh.vertexCount).toBe(expected);
    expect(mesh.vertices).toHaveLength(expected * FLOATS_PER_VERTEX);
  });

  it('indexes only vertices that exist', () => {
    for (const index of mesh.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(mesh.vertexCount);
    }
  });

  it('emits whole triangles', () => {
    expect(mesh.indexCount % 3).toBe(0);
    expect(mesh.triangleCount).toBe(mesh.indexCount / 3);
  });

  it('tags every vertex with its own piece id', () => {
    for (const range of mesh.ranges) {
      for (let v = range.baseVertex; v < range.baseVertex + range.vertexCount; v++) {
        expect(mesh.vertices[v * FLOATS_PER_VERTEX + 3]).toBe(range.piece);
      }
    }
  });

  it('marks the outer ring as edge=0 and the inner ring as edge=1', () => {
    for (const range of mesh.ranges) {
      const half = range.vertexCount / 2;
      for (let k = 0; k < half; k++) {
        expect(mesh.vertices[(range.baseVertex + k) * FLOATS_PER_VERTEX + 2]).toBe(0);
        expect(mesh.vertices[(range.baseVertex + half + k) * FLOATS_PER_VERTEX + 2]).toBe(1);
      }
    }
  });

  it('stores positions in piece-local space, so a transform can rotate them', () => {
    // If positions were world-space, rotating a piece would swing it around the board origin.
    for (const range of mesh.ranges) {
      const piece = board.pieces[range.piece]!;
      for (let v = range.baseVertex; v < range.baseVertex + range.vertexCount; v++) {
        const x = mesh.vertices[v * FLOATS_PER_VERTEX] as number;
        const y = mesh.vertices[v * FLOATS_PER_VERTEX + 1] as number;
        // The mesh stores float32; the reference radius is float64. One f32 ULP at this
        // magnitude is ~8e-6, so the bound needs that slack.
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(piece.boundingRadius * (1 + 1e-6));
      }
    }
  });

  it('gives every piece a contiguous, non-overlapping index range', () => {
    let cursor = 0;
    for (const range of mesh.ranges) {
      expect(range.firstIndex).toBe(cursor);
      expect(range.indexCount).toBeGreaterThan(0);
      cursor += range.indexCount;
    }
    expect(cursor).toBe(mesh.indexCount);
  });

  it('covers every piece', () => {
    expect(mesh.ranges).toHaveLength(board.pieces.length);
    expect(new Set(mesh.ranges.map((r) => r.piece)).size).toBe(board.pieces.length);
  });

  it('respects a custom bevel width', () => {
    const thin = buildBoardMesh(board, { bevelWidth: 0.5 });
    const thick = buildBoardMesh(board, { bevelWidth: 6 });
    // Same topology, different inner ring positions.
    expect(thin.vertexCount).toBe(thick.vertexCount);
    expect(thin.vertices).not.toEqual(thick.vertices);
  });
});

describe('buildPieceStatics', () => {
  const board = generateCut({
    seed: 4,
    shape: { kind: 'hex', rings: 2 },
    radius: 52,
    tab: { tabSize: 0.16, jitter: 0.06 },
  });

  it('stores the solved centre and its normalised position', () => {
    const statics = buildPieceStatics(board);
    expect(statics).toHaveLength(board.pieces.length * 4);
    for (let p = 0; p < board.pieces.length; p++) {
      // float32 storage: ~7 significant digits, so compare in relative terms.
      expect(statics[p * 4]).toBeCloseTo(board.pieces[p]!.center.x, 4);
      expect(statics[p * 4 + 1]).toBeCloseTo(board.pieces[p]!.center.y, 4);
      const u = statics[p * 4 + 2] as number;
      const v = statics[p * 4 + 3] as number;
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('spans the full normalised range across the board', () => {
    const statics = buildPieceStatics(board);
    const us: number[] = [];
    for (let p = 0; p < board.pieces.length; p++) us.push(statics[p * 4 + 2] as number);
    expect(Math.min(...us)).toBeLessThan(0.3);
    expect(Math.max(...us)).toBeGreaterThan(0.7);
  });
});

describe('interior fill completeness', () => {
  /**
   * Regression guard. The fill was originally triangulated from the inward-offset ring, which can
   * self-intersect; ear clipping then returned fewer triangles than the polygon needed and every
   * piece rendered with a hole at its centre. Nothing about the shader or the pipeline would have
   * pointed at the cause. Assert the count directly.
   */
  it('emits a complete fan for every piece, with no missing triangles', () => {
    const board = generateCut({
      seed: 20260902,
      shape: { kind: 'hex', rings: 2 },
      radius: 40,
      tab: { tabSize: 0.18, jitter: 0.05 },
    });
    const mesh = buildBoardMesh(board);
    for (const range of mesh.ranges) {
      const n = board.pieces[range.piece]!.outline.length;
      // Bevel ring: 2 triangles per boundary edge. Interior fill: n - 2 triangles.
      const expectedIndices = n * 6 + (n - 2) * 3;
      expect(range.indexCount).toBe(expectedIndices);
    }
  });

  it('keeps producing a complete fill at an aggressive bevel width', () => {
    const board = generateCut({
      seed: 77,
      shape: { kind: 'hex', rings: 1 },
      radius: 40,
      // Deliberately out of range: the generator clamps it back to something that cannot
      // self-intersect, so the fill stays complete either way.
      tab: { tabSize: 0.2, jitter: 0.09 },
    });
    // Wide enough that the inward offset certainly self-intersects somewhere.
    const mesh = buildBoardMesh(board, { bevelWidth: 12 });
    for (const range of mesh.ranges) {
      const n = board.pieces[range.piece]!.outline.length;
      expect(range.indexCount).toBe(n * 6 + (n - 2) * 3);
    }
  });
});
