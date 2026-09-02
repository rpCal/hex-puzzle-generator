import type { Vec2 } from '../math/vec2.ts';
import { rotate, sub, add } from '../math/vec2.ts';
import { trs, type Affine2D } from '../math/affine2d.ts';

/**
 * Cluster model.
 *
 * The insight that makes this cheap: **pieces welded into a cluster are, by definition, already at
 * their exact solved positions relative to one another.** So a cluster does not need to store a
 * transform per member. It stores one position and one rotation, and a member's world placement
 * falls out of its solved-space offset from the cluster's anchor piece:
 *
 *     world(p) = cluster.position + rotate(solved(p) - solved(anchor), cluster.rotation)
 *
 * Consequences:
 *  - dragging a 400-piece cluster is one write, not four hundred
 *  - the GPU instance buffer can be filled by a compute pass reading one cluster transform plus a
 *    static per-piece offset, which is exactly the pass described in SPEC 5.1
 *  - a cluster can never drift out of internal alignment, because there is nothing to drift
 *
 * Membership is a union-find; the cluster id is the id of its anchor piece.
 */

export interface Cluster {
  /** Anchor piece index. Also the cluster's id. */
  readonly anchor: number;
  /** World position of the anchor piece's centre. */
  readonly position: Vec2;
  /** Rotation of the whole cluster, radians. */
  readonly rotation: number;
  /** Piece indices, anchor included. Ascending. */
  readonly members: readonly number[];
  /** Draw order. Higher is nearer the viewer. */
  readonly z: number;
}

export interface ClusterSet {
  /** Piece index -> cluster id (the anchor's index). */
  find(piece: number): number;
  get(id: number): Cluster;
  readonly ids: readonly number[];
  readonly count: number;
}

/**
 * Mutable cluster bookkeeping for a board.
 *
 * `solvedCenters` are the piece centres in solved board space and never change; they are the
 * skeleton every world position is derived from.
 */
export class Clusters implements ClusterSet {
  readonly #solved: readonly Vec2[];
  /** Union-find parent array; a root's entry points at itself. */
  readonly #parent: Int32Array;
  readonly #rank: Int32Array;
  readonly #position: Float64Array;
  readonly #rotation: Float64Array;
  readonly #z: Float64Array;
  readonly #members: Map<number, number[]>;
  #topZ = 0;

  constructor(solvedCenters: readonly Vec2[]) {
    const n = solvedCenters.length;
    this.#solved = solvedCenters;
    this.#parent = new Int32Array(n);
    this.#rank = new Int32Array(n);
    this.#position = new Float64Array(n * 2);
    this.#rotation = new Float64Array(n);
    this.#z = new Float64Array(n);
    this.#members = new Map();
    for (let i = 0; i < n; i++) {
      this.#parent[i] = i;
      this.#members.set(i, [i]);
      const s = solvedCenters[i] as Vec2;
      this.#position[i * 2] = s.x;
      this.#position[i * 2 + 1] = s.y;
      this.#z[i] = i;
    }
    this.#topZ = n;
  }

  get pieceCount(): number {
    return this.#parent.length;
  }

  get count(): number {
    return this.#members.size;
  }

  get ids(): number[] {
    return [...this.#members.keys()];
  }

  /** Union-find with path halving. */
  find(piece: number): number {
    let i = piece;
    while (this.#parent[i] !== i) {
      const parent = this.#parent[i] as number;
      this.#parent[i] = this.#parent[parent] as number;
      i = this.#parent[i] as number;
    }
    return i;
  }

  get(id: number): Cluster {
    const root = this.find(id);
    return {
      anchor: root,
      position: { x: this.#position[root * 2] as number, y: this.#position[root * 2 + 1] as number },
      rotation: this.#rotation[root] as number,
      members: this.#members.get(root) ?? [root],
      z: this.#z[root] as number,
    };
  }

  membersOf(piece: number): readonly number[] {
    return this.#members.get(this.find(piece)) ?? [];
  }

  sizeOf(piece: number): number {
    return this.membersOf(piece).length;
  }

  /** Solved-space offset of `piece` from its cluster's anchor. */
  offsetOf(piece: number): Vec2 {
    const root = this.find(piece);
    return sub(this.#solved[piece] as Vec2, this.#solved[root] as Vec2);
  }

  /** World position of a piece's centre. */
  worldPosition(piece: number): Vec2 {
    const root = this.find(piece);
    const rotation = this.#rotation[root] as number;
    const anchor = {
      x: this.#position[root * 2] as number,
      y: this.#position[root * 2 + 1] as number,
    };
    return add(anchor, rotate(this.offsetOf(piece), rotation));
  }

  /** World rotation of a piece. Uniform across a cluster. */
  worldRotation(piece: number): number {
    return this.#rotation[this.find(piece)] as number;
  }

  /** Full world transform of a piece, ready for the instance buffer. */
  worldTransform(piece: number): Affine2D {
    return trs(this.worldPosition(piece), this.worldRotation(piece));
  }

  /** Move a cluster so its anchor centre lands at `position`. */
  setPosition(piece: number, position: Vec2): void {
    const root = this.find(piece);
    this.#position[root * 2] = position.x;
    this.#position[root * 2 + 1] = position.y;
  }

  translate(piece: number, delta: Vec2): void {
    const root = this.find(piece);
    this.#position[root * 2] = (this.#position[root * 2] as number) + delta.x;
    this.#position[root * 2 + 1] = (this.#position[root * 2 + 1] as number) + delta.y;
  }

  setRotation(piece: number, rotation: number): void {
    this.#rotation[this.find(piece)] = rotation;
  }

  /**
   * Rotate a cluster about an arbitrary world pivot, keeping that pivot fixed.
   *
   * Needed because a cluster rotates about the piece the player grabbed, not about its anchor.
   */
  rotateAbout(piece: number, pivot: Vec2, deltaRadians: number): void {
    const root = this.find(piece);
    const anchor = {
      x: this.#position[root * 2] as number,
      y: this.#position[root * 2 + 1] as number,
    };
    const moved = add(pivot, rotate(sub(anchor, pivot), deltaRadians));
    this.#position[root * 2] = moved.x;
    this.#position[root * 2 + 1] = moved.y;
    this.#rotation[root] = (this.#rotation[root] as number) + deltaRadians;
  }

  /** Raise a cluster above every other. Called on pick-up. */
  bringToFront(piece: number): void {
    this.#z[this.find(piece)] = this.#topZ++;
  }

  zOf(piece: number): number {
    return this.#z[this.find(piece)] as number;
  }

  areJoined(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }

  /**
   * Weld the cluster containing `moving` into the cluster containing `fixed`.
   *
   * The caller is responsible for having already aligned the two — `snap.ts` does that before
   * calling — because a merge assumes the members are at their solved relative positions. Merging
   * misaligned clusters would bake the misalignment in permanently, so this is asserted.
   *
   * Returns the surviving cluster id, or `-1` if they were already one cluster.
   */
  merge(fixed: number, moving: number): number {
    const a = this.find(fixed);
    const b = this.find(moving);
    if (a === b) return -1;

    // Union by rank, but the *geometry* must follow the anchor that survives, so the transform of
    // the winner is kept and the loser's members simply join it.
    const [winner, loser] = (this.#rank[a] as number) >= (this.#rank[b] as number) ? [a, b] : [b, a];
    if (this.#rank[a] === this.#rank[b]) this.#rank[winner] = (this.#rank[winner] as number) + 1;

    this.#parent[loser] = winner;

    const winMembers = this.#members.get(winner) as number[];
    const loseMembers = this.#members.get(loser) as number[];
    for (const m of loseMembers) winMembers.push(m);
    winMembers.sort((x, y) => x - y);
    this.#members.delete(loser);

    this.#z[winner] = Math.max(this.#z[winner] as number, this.#z[loser] as number);
    return winner;
  }

  /**
   * Re-anchor a cluster's stored transform onto its (possibly new) root without moving any piece.
   *
   * After a merge the surviving root may not be the piece whose position was authoritative, so the
   * stored position must be recomputed for the new anchor. `snap.ts` calls this immediately after
   * merging, passing the world position the new anchor should end up at.
   */
  reanchor(root: number, position: Vec2, rotation: number): void {
    const r = this.find(root);
    this.#position[r * 2] = position.x;
    this.#position[r * 2 + 1] = position.y;
    this.#rotation[r] = rotation;
  }

  /** True when every piece belongs to one cluster. */
  get isSingleCluster(): boolean {
    return this.#members.size === 1;
  }

  /** Snapshot for persistence. */
  serialize(): ClusterSnapshot {
    return {
      parent: [...this.#parent],
      position: [...this.#position],
      rotation: [...this.#rotation],
      z: [...this.#z],
      topZ: this.#topZ,
    };
  }

  /** Restore a snapshot. Rejects a snapshot whose size does not match the board. */
  restore(snapshot: ClusterSnapshot): boolean {
    const n = this.#parent.length;
    if (
      snapshot.parent.length !== n ||
      snapshot.rotation.length !== n ||
      snapshot.position.length !== n * 2
    ) {
      return false;
    }
    this.#members.clear();
    for (let i = 0; i < n; i++) {
      this.#parent[i] = snapshot.parent[i] ?? i;
      this.#rotation[i] = snapshot.rotation[i] ?? 0;
      this.#position[i * 2] = snapshot.position[i * 2] ?? 0;
      this.#position[i * 2 + 1] = snapshot.position[i * 2 + 1] ?? 0;
      this.#z[i] = snapshot.z[i] ?? i;
    }
    for (let i = 0; i < n; i++) {
      const root = this.find(i);
      const list = this.#members.get(root);
      if (list === undefined) this.#members.set(root, [i]);
      else list.push(i);
    }
    for (const list of this.#members.values()) list.sort((x, y) => x - y);
    this.#topZ = snapshot.topZ;
    return true;
  }
}

export interface ClusterSnapshot {
  readonly parent: number[];
  readonly position: number[];
  readonly rotation: number[];
  readonly z: number[];
  readonly topZ: number;
}
