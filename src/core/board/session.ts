import type { CutBoard } from '../cut/board.ts';
import { Clusters, type ClusterSnapshot } from '../solve/clusters.ts';
import { resolveSnaps, type SnapConfig, type SnapResult } from '../solve/snap.ts';
import { Rng } from '../rng/hash32.ts';
import { aabbCenter, aabbSize, add, type Aabb, type Vec2 } from '../math/vec2.ts';
import { modeInfo, type Mode } from '../rules/presets.ts';

/**
 * A playable puzzle, with no rendering and no input handling attached.
 *
 * This is the object the unit tests drive to completion. If a rule cannot be exercised here, it is
 * in the wrong layer — which is the practical enforcement of SPEC 2's dependency direction, and the
 * reason "solve a board" is a fast pure-function test rather than something only a browser can do.
 */

export interface SessionOptions {
  readonly mode: Mode;
  /** Seed for scattering. Independent of the cut seed so re-scattering does not change the cut. */
  readonly scatterSeed: number;
  /** How far outside the board pieces are thrown, as a multiple of the board's half-diagonal. */
  readonly scatterSpread?: number;
  readonly snap?: Partial<SnapConfig>;
}

export interface Progress {
  readonly pieces: number;
  readonly clusters: number;
  readonly joinedEdges: number;
  readonly totalEdges: number;
  /** 0..1 over joined edges, which tracks perceived progress better than pieces placed. */
  readonly fraction: number;
  readonly solved: boolean;
}

const SIXTY_DEGREES = Math.PI / 3;

export class PuzzleSession {
  readonly board: CutBoard;
  readonly clusters: Clusters;
  readonly options: SessionOptions;

  #held: number | null = null;
  #grabOffset: Vec2 = { x: 0, y: 0 };
  #elapsed = 0;
  #started = false;
  #zoom = 1;
  readonly #interiorEdgeCount: number;

  constructor(board: CutBoard, options: SessionOptions) {
    this.board = board;
    this.options = options;
    this.clusters = new Clusters(board.pieces.map((p) => p.center));
    this.#interiorEdgeCount = board.uniqueEdges.filter((e) => !e.isBorder).length;
    this.#zoom = options.snap?.zoom ?? 1;
  }

  /**
   * Current camera zoom, which the snap tolerance scales against.
   *
   * Lives here rather than being read from the camera because `core` may not reach into the game
   * layer -- the caller pushes it in, and a headless test can set it directly.
   */
  get zoom(): number {
    return this.#zoom;
  }

  setZoom(zoom: number): void {
    this.#zoom = zoom > 0 ? zoom : 1;
  }

  get snapConfig(): SnapConfig {
    return {
      radius: this.board.options.radius,
      rotationTolerance: this.options.snap?.rotationTolerance ?? SIXTY_DEGREES / 4,
      ...this.options.snap,
      zoom: this.#zoom,
    };
  }

  /**
   * Throw every piece into an annulus around the board.
   *
   * An annulus rather than a disc so the middle stays clear: pieces scattered over the solved area
   * hide the assembly you are building and make the board unreadable.
   */
  scatter(): void {
    const rng = new Rng(this.options.scatterSeed);
    const centre = aabbCenter(this.board.bounds);
    const size = aabbSize(this.board.bounds);
    const halfDiagonal = Math.hypot(size.x, size.y) / 2;
    const spread = this.options.scatterSpread ?? 1.0;
    const inner = halfDiagonal * 0.98;
    // Tight enough that a fitted camera still leaves pieces big enough to read, loose enough that
    // the solved area in the middle stays clear.
    const outer = halfDiagonal * spread * 1.26;
    const rotates = modeInfo(this.options.mode).rotates;

    for (let i = 0; i < this.board.pieces.length; i++) {
      const angle = rng.next() * Math.PI * 2;
      // sqrt keeps the density uniform over the annulus instead of bunching at the inner edge.
      const t = Math.sqrt(rng.next());
      const radius = inner + (outer - inner) * t;
      this.clusters.setPosition(i, {
        x: centre.x + Math.cos(angle) * radius,
        y: centre.y + Math.sin(angle) * radius,
      });
      this.clusters.setRotation(i, rotates ? rng.int(6) * SIXTY_DEGREES : 0);
    }
  }

  /**
   * Bounds of everything currently on the table, pieces included wherever they have been thrown.
   *
   * The camera frames this rather than the solved board bounds: fitting the board alone would push
   * most of a freshly scattered set off screen.
   */
  currentBounds(): Aabb {
    let min = { x: Infinity, y: Infinity };
    let max = { x: -Infinity, y: -Infinity };
    for (let i = 0; i < this.board.pieces.length; i++) {
      const p = this.clusters.worldPosition(i);
      const r = this.board.pieces[i]?.boundingRadius ?? 0;
      min = { x: Math.min(min.x, p.x - r), y: Math.min(min.y, p.y - r) };
      max = { x: Math.max(max.x, p.x + r), y: Math.max(max.y, p.y + r) };
    }
    return Number.isFinite(min.x) ? { min, max } : this.board.bounds;
  }

  /** Place every piece exactly where it belongs, welding as it goes. For tests and the demo reel. */
  solveInstantly(): void {
    for (let i = 0; i < this.board.pieces.length; i++) {
      this.clusters.setRotation(i, 0);
      this.clusters.setPosition(i, this.board.pieces[i]!.center);
    }
    for (let i = 1; i < this.board.pieces.length; i++) {
      this.release(i);
    }
  }

  get elapsedSeconds(): number {
    return this.#elapsed;
  }

  get isRunning(): boolean {
    return this.#started && !this.isSolved;
  }

  /** Advance the clock. Timed modes only; Zen never accumulates. */
  tick(deltaSeconds: number): void {
    if (!this.#started || this.isSolved) return;
    if (!modeInfo(this.options.mode).timed) return;
    this.#elapsed += Math.max(0, deltaSeconds);
  }

  get heldPiece(): number | null {
    return this.#held;
  }

  /** Pick up the cluster containing `piece`. `at` is the world point under the cursor. */
  grab(piece: number, at?: Vec2): void {
    if (piece < 0 || piece >= this.board.pieces.length) return;
    this.#started = true;
    this.#held = piece;
    this.clusters.bringToFront(piece);
    const world = this.clusters.worldPosition(piece);
    this.#grabOffset = at === undefined ? { x: 0, y: 0 } : { x: world.x - at.x, y: world.y - at.y };
  }

  /** Drag the held cluster so the grabbed point follows `to`. */
  dragTo(to: Vec2): void {
    if (this.#held === null) return;
    const target = add(to, this.#grabOffset);
    const piece = this.#held;
    const current = this.clusters.worldPosition(piece);
    this.clusters.translate(piece, { x: target.x - current.x, y: target.y - current.y });
  }

  /** Rotate the held cluster about the grabbed piece. Rotation modes only. */
  rotateHeld(deltaRadians: number): void {
    if (this.#held === null) return;
    if (!modeInfo(this.options.mode).rotates) return;
    this.clusters.rotateAbout(
      this.#held,
      this.clusters.worldPosition(this.#held),
      deltaRadians,
    );
  }

  /** Move a cluster directly, without a grab. Used by keyboard nudging and the edge-sort assist. */
  moveCluster(piece: number, to: Vec2): void {
    this.#started = true;
    const current = this.clusters.worldPosition(piece);
    this.clusters.translate(piece, { x: to.x - current.x, y: to.y - current.y });
  }

  /** Drop the cluster and resolve any snaps it triggers. */
  release(piece?: number): SnapResult {
    const target = piece ?? this.#held;
    this.#held = null;
    if (target === null) {
      return { joins: [], cluster: -1, solved: this.clusters.isSingleCluster };
    }
    this.#started = true;
    return resolveSnaps(this.board, this.clusters, target, this.snapConfig);
  }

  get isSolved(): boolean {
    return this.clusters.isSingleCluster;
  }

  get progress(): Progress {
    let joined = 0;
    for (const edge of this.board.uniqueEdges) {
      if (edge.isBorder) continue;
      if (this.clusters.areJoined(edge.ownerPiece, edge.otherPiece)) joined++;
    }
    const total = this.#interiorEdgeCount;
    return {
      pieces: this.board.pieces.length,
      clusters: this.clusters.count,
      joinedEdges: joined,
      totalEdges: total,
      fraction: total === 0 ? 1 : joined / total,
      solved: this.isSolved,
    };
  }

  serialize(): SessionSnapshot {
    return { elapsed: this.#elapsed, started: this.#started, clusters: this.clusters.serialize() };
  }

  restore(snapshot: SessionSnapshot): boolean {
    if (!this.clusters.restore(snapshot.clusters)) return false;
    this.#elapsed = snapshot.elapsed;
    this.#started = snapshot.started;
    this.#held = null;
    return true;
  }
}

export interface SessionSnapshot {
  readonly elapsed: number;
  readonly started: boolean;
  readonly clusters: ClusterSnapshot;
}
