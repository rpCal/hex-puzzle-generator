import {
  type Axial,
  HexLayout,
  axialKey,
  axialLess,
  hexBoard,
  neighbor,
  oppositeEdge,
  pieceCount,
  rectBoard,
} from '../math/hex.ts';
import { flattenChain, reverse, type Cubic } from '../math/bezier.ts';
import { aabbOf, aabbUnion, distance, type Aabb, type Vec2 } from '../math/vec2.ts';
import { clampTabParams, edgeJitter, straightEdge, tabbedEdge, type TabParams } from './tab.ts';
import { hash32 } from '../rng/hash32.ts';

/**
 * Board generation: turn `(seed, shape, tab parameters)` into a set of interlocking pieces.
 *
 * The single invariant everything rests on: **each interior edge is generated exactly once**, by
 * whichever of its two hexes is lexicographically smaller, and the other hex borrows that same
 * curve reversed.
 *
 * That is the direct descendant of the 2018 original's `drawWithoudRepeat`. There, drawing each
 * edge once mattered because a doubled stroke prints at double ink density. Here the same discipline
 * carries much more weight: two pieces interlock precisely because they are cut by *literally the
 * same curve*, not by two curves that happen to agree. Floating-point equality is not hoped for, it
 * is structural.
 *
 * Expressing ownership as data rather than as a loop that avoids re-visiting also removes the
 * original's one hand-tuned special case for dangling stubs on the final row.
 */

export type BoardShape =
  | { readonly kind: 'hex'; readonly rings: number }
  | { readonly kind: 'rect'; readonly cols: number; readonly rows: number };

export interface CutOptions {
  readonly seed: number;
  readonly shape: BoardShape;
  /** Hex circumradius in board units. */
  readonly radius: number;
  readonly tab: TabParams;
  /** Polyline error tolerance, in board units. Defaults to 0.4% of the radius. */
  readonly flattenTolerance?: number;
}

export interface Piece {
  readonly index: number;
  readonly cell: Axial;
  /** Hex centre in board space. Also the piece's solved position. */
  readonly center: Vec2;
  /**
   * The boundary split by edge: `edgeCurves[k]` runs from vertex `k` to vertex `k+1`.
   *
   * Kept separate from the flattened `curves` because the interlock guarantee is stated per edge —
   * `edgeCurves[k]` of a piece is exactly `edgeCurves[k+3]` of its neighbour, reversed — and because
   * the print export needs to stroke each shared edge once rather than once per piece.
   */
  readonly edgeCurves: readonly (readonly Cubic[])[];
  /** The closed boundary as one continuous chain of Bezier curves, vertex order 0..5. */
  readonly curves: readonly Cubic[];
  /** The closed boundary flattened to a polyline. First point is not repeated at the end. */
  readonly outline: readonly Vec2[];
  readonly bounds: Aabb;
  /** Max distance from `center` to any outline point. The SDF shader's early-out radius. */
  readonly boundingRadius: number;
  /** Piece index across each of the six edges, or -1 at the board boundary. */
  readonly neighbors: readonly number[];
  /** True when at least one edge is on the board boundary. Drives the "edge sort" assist. */
  readonly isBorder: boolean;
}

export interface CutBoard {
  readonly options: CutOptions;
  readonly layout: HexLayout;
  readonly pieces: readonly Piece[];
  /** `axialKey` -> piece index. */
  readonly byCell: ReadonlyMap<number, number>;
  /** Bounds of the whole assembled board, tabs included. */
  readonly bounds: Aabb;
  /** Total flattened outline points, for buffer sizing. */
  readonly outlinePointCount: number;
  /**
   * Every cut line exactly once, in generation order.
   *
   * This is the print export's whole reason for being able to claim single-stroke output, and the
   * data-level statement of the invariant the 2018 original enforced procedurally.
   */
  readonly uniqueEdges: readonly UniqueEdge[];
}

/** One physical cut line, owned by one piece and shared with at most one other. */
export interface UniqueEdge {
  /** Index of the piece that owns (generated) this edge. */
  readonly ownerPiece: number;
  /** The owner's edge index, 0..5. */
  readonly edgeIndex: number;
  /** Index of the piece on the other side, or -1 on the board boundary. */
  readonly otherPiece: number;
  readonly curves: readonly Cubic[];
  readonly isBorder: boolean;
}

/** Cells for a shape, in a stable order. */
export function cellsFor(shape: BoardShape): Axial[] {
  return shape.kind === 'hex' ? hexBoard(shape.rings) : rectBoard(shape.cols, shape.rows);
}

/** Piece count for a shape, without generating it. */
export function countFor(shape: BoardShape): number {
  return shape.kind === 'hex' ? pieceCount(shape.rings) : shape.cols * shape.rows;
}

/** Identifies the hex that owns a shared edge, and that owner's index for it. */
function ownerOf(cell: Axial, edge: number): { owner: Axial; index: number; borrowed: boolean } {
  const other = neighbor(cell, edge);
  return axialLess(cell, other)
    ? { owner: cell, index: edge, borrowed: false }
    : { owner: other, index: oppositeEdge(edge), borrowed: true };
}

export function generateCut(options: CutOptions): CutBoard {
  const { seed, shape, radius } = options;
  // Guard the cut against parameters that would make an outline self-intersect. See
  // clampTabParams: this is enforced here so no caller can produce pieces with holes in them.
  const tab = clampTabParams(options.tab);
  const tolerance = options.flattenTolerance ?? radius * 0.004;
  const layout = new HexLayout(radius);

  const cells = cellsFor(shape);
  const byCell = new Map<number, number>();
  cells.forEach((c, i) => byCell.set(axialKey(c), i));

  // Cache of generated curves, keyed by owner cell and owner edge index. An interior edge is
  // computed the first time either of its two hexes asks for it, and reused the second time.
  const curveCache = new Map<number, Cubic[]>();

  const curvesForEdge = (cell: Axial, edge: number): Cubic[] => {
    const other = neighbor(cell, edge);
    const isBorderEdge = !byCell.has(axialKey(other));

    // Vertex k -> vertex k+1 is edge k. See math/hex.ts for why this indexing is not arbitrary.
    const from = layout.vertex(cell, edge);
    const to = layout.vertex(cell, edge + 1);

    if (isBorderEdge) return straightEdge(from, to);

    const { owner, index, borrowed } = ownerOf(cell, edge);
    const cacheKey = axialKey(owner) * 6 + index;

    let owned = curveCache.get(cacheKey);
    if (owned === undefined) {
      const ownerKey = axialKey(owner);
      const j = edgeJitter(seed, ownerKey, index, tab);
      owned = tabbedEdge(layout.vertex(owner, index), layout.vertex(owner, index + 1), tab, j);
      curveCache.set(cacheKey, owned);
    }

    if (!borrowed) return owned;

    // The owner traced this edge from its own vertex `index` to `index + 1`, which is our vertex
    // `edge + 1` to `edge`. Reverse both the order of the segments and each segment itself.
    return owned.map(reverse).toReversed();
  };

  const pieces: Piece[] = [];
  const uniqueEdges: UniqueEdge[] = [];
  let bounds: Aabb | null = null;
  let outlinePointCount = 0;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as Axial;
    const edgeCurves: Cubic[][] = [];
    const curves: Cubic[] = [];
    const neighborIndices: number[] = [];
    let isBorder = false;

    for (let edge = 0; edge < 6; edge++) {
      const forEdge = curvesForEdge(cell, edge);
      edgeCurves.push(forEdge);
      for (const c of forEdge) curves.push(c);

      const otherCell = neighbor(cell, edge);
      const n = byCell.get(axialKey(otherCell));
      if (n === undefined) isBorder = true;
      neighborIndices.push(n ?? -1);

      // Record the edge exactly once: either it is a border edge (this piece is its only owner),
      // or it is interior and this piece is the lexicographic owner.
      if (n === undefined || !axialLess(otherCell, cell)) {
        uniqueEdges.push({
          ownerPiece: i,
          edgeIndex: edge,
          otherPiece: n ?? -1,
          curves: forEdge,
          isBorder: n === undefined,
        });
      }
    }

    // The chain is closed: the last curve ends where the first begins, so the shared point is
    // emitted once by flattenChain and the duplicate closing point is dropped.
    const chained = flattenChain(curves, tolerance);
    const outline = chained.slice(0, -1);

    const center = layout.center(cell);
    const pieceBounds = aabbOf(outline);
    let boundingRadius = 0;
    for (const p of outline) {
      const d = distance(center, p);
      if (d > boundingRadius) boundingRadius = d;
    }

    pieces.push({
      index: i,
      cell,
      center,
      edgeCurves,
      curves,
      outline,
      bounds: pieceBounds,
      boundingRadius,
      neighbors: neighborIndices,
      isBorder,
    });

    bounds = bounds === null ? pieceBounds : aabbUnion(bounds, pieceBounds);
    outlinePointCount += outline.length;
  }

  return {
    options,
    layout,
    pieces,
    byCell,
    bounds: bounds ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    outlinePointCount,
    uniqueEdges,
  };
}

/**
 * A 32-bit fingerprint of a generated cut.
 *
 * Exists so determinism can be asserted cheaply over hundreds of seeds without committing hundreds
 * of geometry snapshots. If this value changes for a given seed, every previously shared puzzle link
 * now produces a different puzzle — a breaking change, and the golden test makes it a deliberate one
 * rather than an accident.
 */
export function fingerprint(board: CutBoard): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = hash32(h ^ (v | 0));
  };
  for (const piece of board.pieces) {
    mix(piece.cell.q);
    mix(piece.cell.r);
    for (const p of piece.outline) {
      // Quantised to 1/1024 of a board unit. Far finer than any visible difference, and coarse
      // enough that the last bit of double-precision noise cannot flip the fingerprint.
      mix(Math.round(p.x * 1024));
      mix(Math.round(p.y * 1024));
    }
  }
  return h >>> 0;
}
