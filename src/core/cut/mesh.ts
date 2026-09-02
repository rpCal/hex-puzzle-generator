import type { CutBoard, Piece } from './board.ts';
import type { Vec2 } from '../math/vec2.ts';
import { offsetInward, triangulate } from './triangulate.ts';

/**
 * Turn a cut board into GPU-ready geometry.
 *
 * The whole board becomes **one vertex buffer and one index buffer**, drawn in a single call. Each
 * vertex carries the id of the piece it belongs to, and the vertex shader looks that piece's
 * transform up in a storage buffer. That is strictly better than instancing here, because pieces do
 * not share a mesh — every piece has a different silhouette — so instancing would mean one draw per
 * piece, or a lowest-common-denominator quad and a punishing fragment shader.
 *
 * Each piece contributes two rings of vertices:
 *
 *   - the outline itself, with `edge = 0`
 *   - a copy offset inward by the bevel width, with `edge = 1`
 *
 * and three groups of triangles: a strip between the rings, plus a triangulation of the inner ring
 * to fill the middle. Interpolating `edge` across those triangles gives the fragment shader a
 * cheap, monotone approximation of distance-to-boundary, which is enough to drive:
 *
 *   - analytic anti-aliasing, via `edge / fwidth(edge)`, with no MSAA (and MSAA would have blocked
 *     the `r32uint` picking attachment, which cannot be multisampled and resolved)
 *   - the bevel, inner shadow and rim light, from the same value
 *
 * All of this costs zero per-fragment loops.
 */

/** Bytes per vertex: position (2 x f32), edge (f32), piece id (u32). */
export const VERTEX_STRIDE = 16;
export const FLOATS_PER_VERTEX = 4;

export interface BoardMesh {
  /** Interleaved `[x, y, edge, pieceIdBits]`, positions in piece-local space. */
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly triangleCount: number;
  /** First index and index count for each piece, for debugging and partial draws. */
  readonly ranges: readonly MeshRange[];
}

export interface MeshRange {
  readonly piece: number;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly baseVertex: number;
  readonly vertexCount: number;
}

export interface MeshOptions {
  /** Bevel width in board units. Defaults to 6% of the hex circumradius. */
  readonly bevelWidth?: number;
}

export function buildBoardMesh(board: CutBoard, options: MeshOptions = {}): BoardMesh {
  const bevel = options.bevelWidth ?? board.options.radius * 0.06;

  // Two passes: size everything first so the typed arrays are allocated once. Growing arrays for a
  // thousand pieces is the difference between an instant board and a visible stall.
  let totalVertices = 0;
  let totalIndices = 0;
  const perPiece: { outer: Vec2[]; inner: Vec2[]; fill: Uint32Array }[] = [];

  for (const piece of board.pieces) {
    const outer = piece.outline as Vec2[];
    const inner = offsetInward(outer, bevel);
    // Triangulate the **outer** outline and reuse its topology for the inner ring.
    //
    // Triangulating the inner ring directly is the obvious thing to do and it is wrong: an inward
    // offset can self-intersect where a feature is narrower than twice the bevel, ear clipping then
    // bails out with fewer triangles than it needs, and the piece renders with a hole in the middle
    // that no shader inspection would ever explain. The outer outline is guaranteed simple -- it is
    // the cut itself -- and the inner ring has the same vertex count and ordering, so its indices
    // apply unchanged and the fill is always complete.
    const fill = triangulate(outer);
    perPiece.push({ outer, inner, fill });
    totalVertices += outer.length * 2;
    totalIndices += outer.length * 6 + fill.length;
  }

  const vertices = new Float32Array(totalVertices * FLOATS_PER_VERTEX);
  const indices = new Uint32Array(totalIndices);
  const ranges: MeshRange[] = [];

  // `pieceId` travels as a float attribute rather than a `u32` one so the vertex layout stays a
  // single tightly packed float32x4. Exactly representable for every id below 2^24, which is four
  // orders of magnitude above the largest board.
  let v = 0;
  let i = 0;
  let baseVertex = 0;

  for (let p = 0; p < board.pieces.length; p++) {
    const piece = board.pieces[p] as Piece;
    const { outer, inner, fill } = perPiece[p] as { outer: Vec2[]; inner: Vec2[]; fill: Uint32Array };
    const n = outer.length;
    const firstIndex = i;

    for (let k = 0; k < n; k++) {
      const o = outer[k] as Vec2;
      vertices[v++] = o.x - piece.center.x;
      vertices[v++] = o.y - piece.center.y;
      vertices[v++] = 0;
      vertices[v++] = p;
    }
    for (let k = 0; k < n; k++) {
      const inn = inner[k] as Vec2;
      vertices[v++] = inn.x - piece.center.x;
      vertices[v++] = inn.y - piece.center.y;
      vertices[v++] = 1;
      vertices[v++] = p;
    }

    // Bevel ring. Outer ring is [0, n), inner ring is [n, 2n).
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      indices[i++] = baseVertex + k;
      indices[i++] = baseVertex + k1;
      indices[i++] = baseVertex + n + k;

      indices[i++] = baseVertex + k1;
      indices[i++] = baseVertex + n + k1;
      indices[i++] = baseVertex + n + k;
    }

    // Interior fill, over the inner ring.
    for (const index of fill) indices[i++] = baseVertex + n + index;

    ranges.push({
      piece: p,
      firstIndex,
      indexCount: i - firstIndex,
      baseVertex,
      vertexCount: n * 2,
    });
    baseVertex += n * 2;
  }

  return {
    vertices,
    indices,
    vertexCount: totalVertices,
    indexCount: totalIndices,
    triangleCount: totalIndices / 3,
    ranges,
  };
}

/** Bytes per piece in the GPU piece-data storage buffer. Must match `PieceData` in `piece.wgsl`. */
export const PIECE_DATA_STRIDE = 64;
export const PIECE_DATA_FLOATS = PIECE_DATA_STRIDE / 4;

/**
 * Static per-piece data the GPU needs and that never changes for a given board: the solved centre,
 * used to look the piece up in the source image atlas.
 *
 * Uploaded once. The dynamic half of `PieceData` — transform, tint, flags — is written every frame
 * by the cluster compute pass.
 */
export function buildPieceStatics(board: CutBoard): Float32Array {
  const out = new Float32Array(board.pieces.length * 4);
  const min = board.bounds.min;
  const width = board.bounds.max.x - min.x;
  const height = board.bounds.max.y - min.y;
  for (let p = 0; p < board.pieces.length; p++) {
    const piece = board.pieces[p] as Piece;
    out[p * 4 + 0] = piece.center.x;
    out[p * 4 + 1] = piece.center.y;
    // Normalised solved position, so the shader can derive atlas UVs without knowing board bounds.
    out[p * 4 + 2] = width === 0 ? 0 : (piece.center.x - min.x) / width;
    out[p * 4 + 3] = height === 0 ? 0 : (piece.center.y - min.y) / height;
  }
  return out;
}
