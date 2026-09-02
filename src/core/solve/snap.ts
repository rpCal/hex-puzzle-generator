import type { CutBoard } from '../cut/board.ts';
import type { Clusters } from './clusters.ts';
import { add, distance, rotate, sub, type Vec2 } from '../math/vec2.ts';

/**
 * Snapping: deciding when two pieces are close enough to weld, and welding them exactly.
 */

export interface SnapConfig {
  /** Hex circumradius in board units. */
  readonly radius: number;
  /** Current camera zoom. World units per screen unit is `1 / zoom`. */
  readonly zoom: number;
  /** Maximum orientation mismatch, radians. Only meaningful when the mode rotates pieces. */
  readonly rotationTolerance: number;
}

const TOLERANCE_AT_UNIT_ZOOM = 0.28;
const TOLERANCE_MIN = 0.12;
const TOLERANCE_MAX = 0.5;

/**
 * How far apart two pieces may be and still snap, in board units.
 *
 * Scaled by `1 / zoom` so the tolerance is **constant in screen space**. A fixed world-space
 * tolerance is the classic mistake: zoomed out, every piece is within tolerance of every other and
 * the puzzle solves itself; zoomed in, the tolerance is a few pixels and the game feels broken.
 * Players judge "close enough" with their eyes, so the tolerance has to live in their units.
 *
 * Clamped at both ends so that extreme zoom cannot make snapping impossible or automatic.
 */
export function snapTolerance(radius: number, zoom: number): number {
  const raw = (TOLERANCE_AT_UNIT_ZOOM * radius) / (zoom > 0 ? zoom : 1);
  return Math.min(TOLERANCE_MAX * radius, Math.max(TOLERANCE_MIN * radius, raw));
}

/** Signed angle difference in `(-pi, pi]`. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export interface SnapCandidate {
  /** Piece in the cluster being moved. */
  readonly piece: number;
  /** Adjacent piece in a different cluster. */
  readonly neighbor: number;
  /** Edge index of `piece` that `neighbor` sits across. */
  readonly edge: number;
  /** Positional error in board units. */
  readonly error: number;
  /** Orientation error in radians. */
  readonly angleError: number;
}

/**
 * Every neighbour of the moved cluster that is currently within snapping range.
 *
 * Sorted by positional error so the closest match wins when a piece could snap to more than one
 * neighbour at once.
 */
export function findSnaps(
  board: CutBoard,
  clusters: Clusters,
  movedPiece: number,
  config: SnapConfig,
): SnapCandidate[] {
  const tolerance = snapTolerance(config.radius, config.zoom);
  const movingRoot = clusters.find(movedPiece);
  const candidates: SnapCandidate[] = [];

  for (const piece of clusters.membersOf(movedPiece)) {
    const info = board.pieces[piece];
    if (info === undefined) continue;
    const pieceWorld = clusters.worldPosition(piece);
    const pieceRotation = clusters.worldRotation(piece);

    for (let edge = 0; edge < 6; edge++) {
      const other = info.neighbors[edge] as number;
      if (other === -1) continue;
      if (clusters.find(other) === movingRoot) continue;

      const angleError = angleDelta(pieceRotation, clusters.worldRotation(other));
      if (Math.abs(angleError) > config.rotationTolerance) continue;

      // Where `other` would sit if it were already welded to this piece: the solved offset between
      // them, rotated into the moving cluster's current orientation.
      const solvedOffset = sub(
        board.pieces[other]!.center,
        board.pieces[piece]!.center,
      );
      const expected = add(pieceWorld, rotate(solvedOffset, pieceRotation));
      const error = distance(expected, clusters.worldPosition(other));
      if (error > tolerance) continue;

      candidates.push({ piece, neighbor: other, edge, error, angleError });
    }
  }

  candidates.sort((a, b) => a.error - b.error);
  return candidates;
}

/**
 * Weld the moved cluster onto the neighbour's cluster.
 *
 * The moved cluster is aligned **exactly** first — not nudged toward alignment — so the merged
 * cluster's members are at their true solved relative positions and the "no internal drift"
 * property of the cluster model holds. Returns the surviving cluster id, or -1 if the two were
 * already joined.
 */
export function applySnap(board: CutBoard, clusters: Clusters, candidate: SnapCandidate): number {
  const { piece, neighbor } = candidate;
  if (clusters.areJoined(piece, neighbor)) return -1;

  const fixedAnchor = clusters.find(neighbor);
  const fixedPosition = clusters.get(fixedAnchor).position;
  const fixedRotation = clusters.get(fixedAnchor).rotation;

  const solvedOf = (index: number): Vec2 => board.pieces[index]!.center;
  const fixedAnchorSolved = solvedOf(fixedAnchor);

  // Where `piece` belongs, expressed in the fixed cluster's frame.
  const targetPiecePosition = add(
    fixedPosition,
    rotate(sub(solvedOf(piece), fixedAnchorSolved), fixedRotation),
  );

  // Place the moving cluster so `piece` lands exactly there, at the fixed cluster's orientation.
  const movingAnchor = clusters.find(piece);
  const movingAnchorPosition = sub(
    targetPiecePosition,
    rotate(sub(solvedOf(piece), solvedOf(movingAnchor)), fixedRotation),
  );
  clusters.setRotation(movingAnchor, fixedRotation);
  clusters.setPosition(movingAnchor, movingAnchorPosition);

  const survivor = clusters.merge(fixedAnchor, movingAnchor);
  if (survivor === -1) return -1;

  // Re-state the surviving cluster's transform directly in the fixed frame. Algebraically this is
  // already where it is; doing it explicitly stops float error accumulating across a long chain of
  // merges, which over a 1000-piece board would otherwise become visible.
  clusters.reanchor(
    survivor,
    add(fixedPosition, rotate(sub(solvedOf(survivor), fixedAnchorSolved), fixedRotation)),
    fixedRotation,
  );

  return survivor;
}

export interface SnapResult {
  /** Pairs that welded, in the order they welded. */
  readonly joins: readonly SnapCandidate[];
  /** Cluster id the moved piece ended up in. */
  readonly cluster: number;
  /** True when the whole board is now one cluster. */
  readonly solved: boolean;
}

/**
 * Resolve every snap triggered by releasing `movedPiece`, including cascades.
 *
 * One snap can bring a third cluster into range, so this repeats until nothing more connects. The
 * iteration cap is a safety net: each pass merges at least one cluster, so it cannot legitimately
 * run more times than there are pieces.
 */
export function resolveSnaps(
  board: CutBoard,
  clusters: Clusters,
  movedPiece: number,
  config: SnapConfig,
): SnapResult {
  const joins: SnapCandidate[] = [];
  const limit = board.pieces.length + 1;

  for (let pass = 0; pass < limit; pass++) {
    const candidates = findSnaps(board, clusters, movedPiece, config);
    const best = candidates[0];
    if (best === undefined) break;
    if (applySnap(board, clusters, best) === -1) break;
    joins.push(best);
  }

  return {
    joins,
    cluster: clusters.find(movedPiece),
    solved: clusters.isSingleCluster,
  };
}

/**
 * Midpoint of the shared edge between two welded pieces, in world space.
 *
 * Used as the emission point for the snap particle burst, so the effect appears along the seam that
 * just closed rather than at a piece centre.
 */
export function joinMidpoint(board: CutBoard, clusters: Clusters, candidate: SnapCandidate): Vec2 {
  const piece = board.pieces[candidate.piece];
  if (piece === undefined) return { x: 0, y: 0 };
  const curves = piece.edgeCurves[candidate.edge];
  const first = curves?.[0];
  const last = curves?.at(-1);
  if (first === undefined || last === undefined) return clusters.worldPosition(candidate.piece);

  const localMid = {
    x: (first.p0.x + last.p3.x) / 2 - piece.center.x,
    y: (first.p0.y + last.p3.y) / 2 - piece.center.y,
  };
  const rotation = clusters.worldRotation(candidate.piece);
  return add(clusters.worldPosition(candidate.piece), rotate(localMid, rotation));
}

/** Sanity helper for tests and the HUD: how many edges are correctly joined. */
export function joinedEdgeCount(board: CutBoard, clusters: Clusters): number {
  let count = 0;
  for (const piece of board.pieces) {
    for (let edge = 0; edge < 6; edge++) {
      const other = piece.neighbors[edge] as number;
      if (other === -1 || other < piece.index) continue;
      if (clusters.areJoined(piece.index, other)) count++;
    }
  }
  return count;
}
