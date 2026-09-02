import type { PuzzleSession } from '@core/board/session.ts';
import type { Vec2 } from '@core/math/vec2.ts';
import { rotate, sub, add } from '@core/math/vec2.ts';
import { CLUSTER_STRIDE_FLOATS, type FrameState } from '@gfx/renderer.ts';
import type { Camera } from './camera.ts';

/**
 * Pack a session's cluster state into the flat arrays the renderer's compute pass expects.
 *
 * Cluster ids are anchor piece indices and therefore sparse; the GPU wants dense slots. The mapping
 * is rebuilt only when the set of clusters changes — which is on a snap, not on a drag — so the
 * per-frame cost of moving a 400-piece cluster stays at one small buffer write.
 */

export const NO_CLUSTER = 0xffffffff;

export interface PackedClusters {
  readonly clusters: Float32Array;
  readonly pieceCluster: Uint32Array;
  readonly clusterCount: number;
  readonly heldCluster: number;
  /** Bumped whenever the piece -> slot mapping changed and must be re-uploaded. */
  readonly mappingRevision: number;
}

export class ClusterPacker {
  readonly #session: PuzzleSession;
  readonly #clusters: Float32Array;
  readonly #pieceCluster: Uint32Array;
  #slotOf = new Map<number, number>();
  #revision = 0;
  #lastSignature = '';

  constructor(session: PuzzleSession) {
    this.#session = session;
    const n = session.board.pieces.length;
    this.#clusters = new Float32Array(n * CLUSTER_STRIDE_FLOATS);
    this.#pieceCluster = new Uint32Array(n);
  }

  pack(highlightOf?: (cluster: number) => number, alphaOf?: (cluster: number) => number): PackedClusters {
    const session = this.#session;
    const clusters = session.clusters;
    const ids = clusters.ids;

    // The mapping only changes when clusters merge, so compare a cheap signature rather than
    // rebuilding and re-uploading a thousand indices every frame.
    const signature = `${ids.length}:${ids.length > 0 ? ids[0] : -1}:${clusters.count}`;
    if (signature !== this.#lastSignature) {
      this.#slotOf = new Map(ids.map((id, slot) => [id, slot]));
      for (let piece = 0; piece < this.#pieceCluster.length; piece++) {
        this.#pieceCluster[piece] = this.#slotOf.get(clusters.find(piece)) ?? 0;
      }
      this.#lastSignature = signature;
      this.#revision++;
    } else {
      // Slots are stable but membership may have shifted within them.
      for (let piece = 0; piece < this.#pieceCluster.length; piece++) {
        this.#pieceCluster[piece] = this.#slotOf.get(clusters.find(piece)) ?? 0;
      }
    }

    const held = session.heldPiece;
    const heldRoot = held === null ? -1 : clusters.find(held);
    const topZ = Math.max(1, ...ids.map((id) => clusters.zOf(id)));

    for (let slot = 0; slot < ids.length; slot++) {
      const id = ids[slot] as number;
      const cluster = clusters.get(id);
      const base = slot * CLUSTER_STRIDE_FLOATS;
      this.#clusters[base + 0] = cluster.position.x;
      this.#clusters[base + 1] = cluster.position.y;
      this.#clusters[base + 2] = session.board.pieces[cluster.anchor]?.center.x ?? 0;
      this.#clusters[base + 3] = session.board.pieces[cluster.anchor]?.center.y ?? 0;
      this.#clusters[base + 4] = cluster.rotation;
      // Depth: nearer the viewer is a smaller value, and the range is kept clear of the clip
      // planes so the shadow instance always has somewhere to sit behind its piece.
      this.#clusters[base + 5] = 0.9 - 0.8 * (cluster.z / topZ);
      this.#clusters[base + 6] = alphaOf?.(id) ?? 1;
      this.#clusters[base + 7] = highlightOf?.(id) ?? 0;
    }

    return {
      clusters: this.#clusters,
      pieceCluster: this.#pieceCluster,
      clusterCount: ids.length,
      heldCluster: heldRoot === -1 ? NO_CLUSTER : (this.#slotOf.get(heldRoot) ?? NO_CLUSTER),
      mappingRevision: this.#revision,
    };
  }
}

export interface BuildFrameOptions {
  readonly camera: Camera;
  readonly timeSeconds: number;
  readonly deltaSeconds: number;
  readonly reveal?: number;
  readonly tint?: readonly [number, number, number];
  readonly exposure?: number;
  readonly vignette?: number;
  readonly grain?: number;
  readonly bloom?: number;
}

export function buildFrame(packed: PackedClusters, options: BuildFrameOptions): FrameState {
  return {
    viewProjection: options.camera.viewProjection,
    clusters: packed.clusters,
    clusterCount: packed.clusterCount,
    pieceCluster: packed.pieceCluster,
    heldCluster: packed.heldCluster,
    timeSeconds: options.timeSeconds,
    deltaSeconds: options.deltaSeconds,
    reveal: options.reveal ?? 1,
    tint: options.tint ?? [0.65, 0.78, 1],
    ...(options.exposure === undefined ? {} : { exposure: options.exposure }),
    ...(options.vignette === undefined ? {} : { vignette: options.vignette }),
    ...(options.grain === undefined ? {} : { grain: options.grain }),
    ...(options.bloom === undefined ? {} : { bloom: options.bloom }),
  };
}

/**
 * The CPU reference for what the cluster compute pass should produce.
 *
 * Kept deliberately close to the WGSL so a GPU test can compare the two directly. When they
 * disagree, one of them is wrong and the test says which piece.
 */
export function referencePieceTransform(
  packed: PackedClusters,
  solvedCentre: Vec2,
  piece: number,
): { position: Vec2; rotation: number } {
  const slot = packed.pieceCluster[piece] ?? 0;
  const base = slot * CLUSTER_STRIDE_FLOATS;
  const clusterPosition: Vec2 = {
    x: packed.clusters[base + 0] ?? 0,
    y: packed.clusters[base + 1] ?? 0,
  };
  const anchorSolved: Vec2 = {
    x: packed.clusters[base + 2] ?? 0,
    y: packed.clusters[base + 3] ?? 0,
  };
  const rotation = packed.clusters[base + 4] ?? 0;
  return {
    position: add(clusterPosition, rotate(sub(solvedCentre, anchorSolved), rotation)),
    rotation,
  };
}
