import { generateCut, type CutBoard } from '@core/cut/board.ts';
import { PuzzleSession } from '@core/board/session.ts';
import { difficultyInfo, modeInfo, type Difficulty, type Mode } from '@core/rules/presets.ts';
import { scoreRun, type ParMultiplierKey } from '@core/score/par.ts';
import { encodePuzzleId, type PuzzleId } from '@core/seed/codec.ts';
import { joinMidpoint } from '@core/solve/snap.ts';
import { add, distance, sub, type Vec2 } from '@core/math/vec2.ts';
import type { Renderer } from '@gfx/renderer.ts';
import type { GpuContext } from '@gfx/device.ts';
import { Camera } from './camera.ts';
import { ClusterPacker, buildFrame } from './frame.ts';
import { GameAudio } from './audio.ts';
import { ParticleSpawner } from './particles.ts';
import { Persistence, debounce, type Prefs } from './storage.ts';

/**
 * The game loop and everything that drives it.
 *
 * Simulation runs on a fixed step and rendering interpolates, so behaviour does not change with
 * frame rate — the drag spring in particular would be a different spring at 30fps and 144fps if it
 * integrated raw deltas.
 */

const FIXED_STEP = 1 / 120;
const MAX_CATCHUP = 0.25;
const BASE_RADIUS = 52;
/** Screen pixels a single arrow-key press moves a piece. Constant in screen space, like snapping. */
const KEY_STEP_PIXELS = 26;
const KEY_STEP_COARSE = 4;
const SIXTY_DEGREES = Math.PI / 3;

export interface AppEvents {
  onProgress?: (app: HexforgeApp) => void;
  onSolved?: (app: HexforgeApp, stars: number, isRecord: boolean) => void;
  onStatus?: (message: string) => void;
  onFocusChange?: (piece: number | null) => void;
}

interface PendingPointer {
  readonly id: number;
  /** Where the press landed, which is what the grab offset is measured from. */
  readonly start: Vec2;
  /** Where the pointer is now, tracked while the pick readback is in flight. */
  latest: Vec2;
  released: boolean;
}

export interface AppOptions {
  readonly gpu: GpuContext;
  readonly renderer: Renderer;
  readonly persistence?: Persistence;
  readonly events?: AppEvents;
  /** Override the hex radius. Tests use a smaller board to keep SwiftShader honest. */
  readonly radius?: number;
}

export class HexforgeApp {
  readonly gpu: GpuContext;
  readonly renderer: Renderer;
  readonly camera = new Camera();
  readonly audio = new GameAudio();
  readonly persistence: Persistence;
  readonly events: AppEvents;

  board!: CutBoard;
  session!: PuzzleSession;
  puzzle!: PuzzleId;
  prefs: Prefs;

  #packer!: ClusterPacker;
  #spawner: ParticleSpawner;
  #radius: number;
  #running = false;
  #rafHandle = 0;
  #lastTime = 0;
  #accumulator = 0;
  #elapsedRender = 0;
  #reveal = 1;
  #focus: number | null = null;
  #dragPointer: number | null = null;
  #dragTarget: Vec2 = { x: 0, y: 0 };
  #panPointer: number | null = null;
  #panLast: Vec2 = { x: 0, y: 0 };
  #lastMappingRevision = -1;
  #solvedAnnounced = false;
  #gamepadGrabbed = false;
  /** Cluster id -> the render time it was last touched. Drives the Blitz fade. */
  #lastTouched = new Map<number, number>();
  #saveSession: (() => void) & { flush(): void; cancel(): void };
  /** Frame durations in ms, for the perf test and the HUD. */
  readonly frameTimes: number[] = [];

  constructor(options: AppOptions) {
    this.gpu = options.gpu;
    this.renderer = options.renderer;
    this.persistence = options.persistence ?? new Persistence();
    this.events = options.events ?? {};
    this.#radius = options.radius ?? BASE_RADIUS;
    this.#spawner = new ParticleSpawner(this.renderer.particleCapacity);
    this.prefs = this.persistence.loadPrefs();
    this.audio.setVolume(this.prefs.volume);
    this.#saveSession = debounce(() => {
      if (this.session !== undefined && !this.session.isSolved) {
        this.persistence.saveSession(this.puzzleCode, this.session.serialize());
      }
    }, 2000);
  }

  get puzzleCode(): string {
    return encodePuzzleId(this.puzzle);
  }

  get focusedPiece(): number | null {
    return this.#focus;
  }

  // -------------------------------------------------------------------------------------------
  // Board lifecycle

  /**
   * Start a puzzle. `resume` restores a saved board for the same puzzle if one exists, which is
   * what makes closing the tab mid-solve a non-event.
   */
  start(puzzle: PuzzleId, options: { resume?: boolean } = {}): void {
    this.puzzle = puzzle;
    const difficulty = difficultyInfo(puzzle.difficulty);
    const rings = puzzle.rings > 0 ? puzzle.rings : difficulty.rings;

    this.board = generateCut({
      seed: puzzle.seed,
      shape: { kind: 'hex', rings },
      radius: this.#radius,
      tab: difficulty.tab,
      // Coarser flattening on bigger boards. Pieces are smaller on screen there, so the extra
      // precision would be invisible while costing real time in triangulation and upload.
      flattenTolerance: this.#radius * (rings > 8 ? 0.012 : 0.005),
    });

    this.session = new PuzzleSession(this.board, {
      mode: puzzle.mode,
      scatterSeed: puzzle.seed ^ 0x5bf03635,
      snap: { zoom: 1 },
    });
    this.#packer = new ClusterPacker(this.session);

    this.renderer.setBoard(this.board);
    this.renderer.setArt(puzzle.imageId % 4, (puzzle.imageId >> 2) + puzzle.seed * 0.000_37);
    const cleared = this.#spawner.clearAll();
    this.renderer.writeParticles(cleared.firstSlot, cleared.data);

    let restored = false;
    if (options.resume === true) {
      const saved = this.persistence.loadSession(this.puzzleCode);
      if (saved !== null) restored = this.session.restore(saved.snapshot);
    }
    if (!restored) {
      this.session.scatter();
      this.persistence.clearSession();
    }

    this.camera.fit(this.session.currentBounds(), 1.22);
    this.#reveal = 1;
    this.#lastTouched.clear();
    this.#focus = null;
    this.#solvedAnnounced = false;
    this.#lastMappingRevision = -1;
    this.events.onProgress?.(this);
    this.events.onStatus?.(
      restored
        ? 'Resumed your board.'
        : `${difficulty.name}: ${this.board.pieces.length} pieces. ${modeInfo(puzzle.mode).blurb}`,
    );
  }

  get parKey(): ParMultiplierKey {
    return modeInfo(this.puzzle.mode).key as ParMultiplierKey;
  }

  // -------------------------------------------------------------------------------------------
  // Loop

  resume(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = performance.now();
    const tick = (now: number): void => {
      if (!this.#running) return;
      this.#frame(now);
      this.#rafHandle = requestAnimationFrame(tick);
    };
    this.#rafHandle = requestAnimationFrame(tick);
  }

  pause(): void {
    this.#running = false;
    if (this.#rafHandle !== 0) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = 0;
    this.#saveSession.flush();
  }

  /** Advance and draw exactly one frame. Used by the loop, and directly by tests. */
  step(deltaSeconds: number): void {
    this.#simulate(deltaSeconds);
    this.#draw(deltaSeconds);
  }

  #frame(now: number): void {
    const started = now;
    let delta = (now - this.#lastTime) / 1000;
    this.#lastTime = now;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    // A backgrounded tab returns a huge delta. Catching up on ten seconds of physics in one frame
    // would fling every piece off the board; drop the excess instead.
    this.#accumulator = Math.min(this.#accumulator + delta, MAX_CATCHUP);

    while (this.#accumulator >= FIXED_STEP) {
      this.#simulate(FIXED_STEP);
      this.#accumulator -= FIXED_STEP;
    }
    this.#draw(delta);

    const elapsed = performance.now() - started;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > 600) this.frameTimes.shift();
  }

  #simulate(dt: number): void {
    this.session.tick(dt);
    this.#pollGamepad(dt);

    if (this.#dragPointer !== null) {
      // Spring-damped follow rather than teleporting to the cursor. The lag is small enough to feel
      // responsive and large enough to give the cluster apparent mass.
      const held = this.session.heldPiece;
      if (held !== null) {
        const current = this.session.clusters.worldPosition(held);
        const toTarget = sub(this.#dragTarget, current);
        const stiffness = 26;
        const factor = 1 - Math.exp(-stiffness * dt);
        this.session.clusters.translate(held, {
          x: toTarget.x * factor,
          y: toTarget.y * factor,
        });
      }
    }

    if (this.session.isSolved) {
      // Fade the cut shading out, leaving the picture seamless.
      this.#reveal = Math.max(0, this.#reveal - dt / 0.8);
    }
  }

  #draw(dt: number): void {
    this.#elapsedRender += dt;
    const packed = this.#packer.pack(
      (cluster) => (this.#focus !== null && this.session.clusters.find(this.#focus) === cluster ? 0.22 : 0),
      (cluster) => this.#alphaOf(cluster),
    );
    if (packed.mappingRevision !== this.#lastMappingRevision) {
      this.renderer.setPieceClusters(packed.pieceCluster);
      this.#lastMappingRevision = packed.mappingRevision;
    }
    this.renderer.render(
      buildFrame(packed, {
        camera: this.camera,
        timeSeconds: this.#elapsedRender,
        deltaSeconds: this.prefs.reducedMotion ? 0 : dt,
        reveal: this.#reveal,
        cutContrast: this.prefs.highContrastCuts ? 0.85 : 0,
        tint: this.prefs.colorblind ? [1, 0.82, 0.35] : [0.65, 0.78, 1],
        grain: this.prefs.reducedMotion ? 0 : 0.012,
        bloom: this.prefs.reducedMotion ? 0.2 : 0.55,
      }),
    );
  }

  /**
   * How visible a cluster is.
   *
   * Only Blitz uses this: a cluster you have not touched for a while fades toward transparent, so
   * deliberating has a cost. It never reaches zero -- a piece you cannot see at all is a piece you
   * cannot finish the board without.
   */
  #alphaOf(cluster: number): number {
    const fadeSeconds = modeInfo(this.puzzle.mode).fadeSeconds;
    if (fadeSeconds <= 0) return 1;
    const touched = this.#lastTouched.get(cluster);
    if (touched === undefined) {
      this.#lastTouched.set(cluster, this.#elapsedRender);
      return 1;
    }
    const idle = this.#elapsedRender - touched;
    if (idle <= fadeSeconds) return 1;
    return Math.max(0.16, 1 - (idle - fadeSeconds) / fadeSeconds);
  }

  /** Mark a cluster as handled, restoring it to full opacity in Blitz. */
  #touch(piece: number): void {
    this.#lastTouched.set(this.session.clusters.find(piece), this.#elapsedRender);
  }

  resize(width: number, height: number, dpr = 1): void {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    this.gpu.canvas.width = w;
    this.gpu.canvas.height = h;
    this.renderer.resize(w, h);
    this.camera.setViewport(w, h);
  }

  // -------------------------------------------------------------------------------------------
  // Pointer

  /** Canvas-relative CSS pixels to device pixels, which is what the renderer and camera use. */
  #toDevice(clientX: number, clientY: number): Vec2 {
    const rect = this.gpu.canvas.getBoundingClientRect();
    const scaleX = this.gpu.canvas.width / Math.max(1, rect.width);
    const scaleY = this.gpu.canvas.height / Math.max(1, rect.height);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  /**
   * Begin an interaction.
   *
   * Picking is a GPU readback, so it resolves a frame or two later — and a quick flick can produce
   * the whole down/move/up sequence before it does. Rather than dropping those, the pointer is
   * recorded synchronously and its latest position tracked; when the pick lands, the drag is
   * reconstructed from what actually happened, including the case where the pointer is already up.
   */
  async pointerDown(pointerId: number, clientX: number, clientY: number): Promise<void> {
    this.audio.unlock();
    const device = this.#toDevice(clientX, clientY);
    const pending: PendingPointer = {
      id: pointerId,
      start: device,
      latest: device,
      released: false,
    };
    this.#pending = pending;

    const piece = await this.renderer.pick(device.x, device.y);

    // A newer press superseded this one while the readback was in flight.
    if (this.#pending !== pending) return;
    this.#pending = null;

    if (piece < 0) {
      // Empty board: pan. If the pointer is already up there is nothing left to do.
      if (!pending.released) {
        this.#panPointer = pointerId;
        this.#panLast = pending.latest;
      }
      return;
    }

    this.#focus = piece;
    this.#touch(piece);
    this.events.onFocusChange?.(piece);

    const grabWorld = this.camera.screenToWorld(pending.start);
    this.session.grab(piece, grabWorld);
    this.#grabOffset = sub(this.session.clusters.worldPosition(piece), grabWorld);
    this.#dragTarget = add(this.camera.screenToWorld(pending.latest), this.#grabOffset);
    if (!this.prefs.reducedMotion) this.audio.pickup();

    if (pending.released) {
      // The whole gesture completed before the pick returned. Honour it as a drag anyway.
      this.#finishDrag();
      return;
    }
    this.#dragPointer = pointerId;
  }

  #grabOffset: Vec2 = { x: 0, y: 0 };
  #pending: PendingPointer | null = null;

  pointerMove(pointerId: number, clientX: number, clientY: number): void {
    const device = this.#toDevice(clientX, clientY);

    if (this.#pending !== null && this.#pending.id === pointerId) {
      this.#pending.latest = device;
      return;
    }
    if (pointerId === this.#panPointer) {
      this.camera.panByScreen(device.x - this.#panLast.x, device.y - this.#panLast.y);
      this.#panLast = device;
      return;
    }
    if (pointerId !== this.#dragPointer) return;
    this.#dragTarget = add(this.camera.screenToWorld(device), this.#grabOffset);
  }

  pointerUp(pointerId: number): void {
    if (this.#pending !== null && this.#pending.id === pointerId) {
      // Still waiting on the pick. Record the release; `pointerDown` completes the gesture.
      this.#pending.released = true;
      return;
    }
    if (pointerId === this.#panPointer) {
      this.#panPointer = null;
      return;
    }
    if (pointerId !== this.#dragPointer) return;
    this.#dragPointer = null;
    this.#finishDrag();
  }

  #finishDrag(): void {
    // Land the piece where it was dropped, not where the spring had got to. The spring exists to
    // give a dragged cluster apparent mass; letting its lag decide whether a snap succeeds would
    // mean a quick, accurate drop failing where a slow, sloppy one worked.
    const held = this.session.heldPiece;
    if (held !== null) {
      const current = this.session.clusters.worldPosition(held);
      this.session.clusters.translate(held, {
        x: this.#dragTarget.x - current.x,
        y: this.#dragTarget.y - current.y,
      });
    }
    this.#releaseHeld();
  }

  #releaseHeld(): void {
    const held = this.session.heldPiece;
    if (held === null) return;
    this.session.setZoom(this.camera.zoom);
    const result = this.session.release();

    this.#touch(held);

    if (result.joins.length > 0) {
      const size = this.session.clusters.sizeOf(held);
      this.audio.snap(size);
      if (!this.prefs.reducedMotion) {
        for (const join of result.joins.slice(0, 3)) {
          const at = joinMidpoint(this.board, this.session.clusters, join);
          const burst = this.#spawner.burst(at, this.prefs.colorblind ? [1, 0.8, 0.3] : [0.7, 0.85, 1], {
            count: 34,
            speed: this.#radius * 1.8,
            size: this.#radius * 0.06,
          });
          this.renderer.writeParticles(burst.firstSlot, burst.data);
        }
      }
      this.events.onProgress?.(this);
      this.#saveSession();
    }

    if (this.session.isSolved && !this.#solvedAnnounced) {
      this.#solvedAnnounced = true;
      this.#onSolved();
    }
  }

  #onSolved(): void {
    this.persistence.clearSession();
    this.#saveSession.cancel();
    const score = scoreRun(this.session.elapsedSeconds, this.board.pieces.length, this.parKey);
    const key = Persistence.runKey(this.puzzleCode, this.puzzle.mode, this.puzzle.difficulty);
    const isRecord = this.persistence.recordRun(key, score.elapsedSeconds, score.stars);
    this.audio.complete();
    this.events.onSolved?.(this, score.stars, isRecord);
  }

  wheel(clientX: number, clientY: number, deltaY: number): void {
    const device = this.#toDevice(clientX, clientY);
    this.camera.zoomAbout(device, Math.exp(-deltaY * 0.0015));
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard
  //
  // A board must be completable with no pointer at all. Tab cycles pieces, arrows nudge the focused
  // cluster by a constant *screen* distance, Enter attempts a snap.

  /** Returns true when the key was consumed. */
  handleKey(key: string, modifiers: { shift?: boolean } = {}): boolean {
    this.audio.unlock();
    const pieces = this.board.pieces.length;
    const step = (KEY_STEP_PIXELS * (modifiers.shift === true ? KEY_STEP_COARSE : 1)) / this.camera.zoom;

    switch (key) {
      case 'Tab':
        this.#cycleFocus(modifiers.shift === true ? -1 : 1);
        return true;
      case 'ArrowLeft':
        return this.#nudge(-step, 0);
      case 'ArrowRight':
        return this.#nudge(step, 0);
      case 'ArrowUp':
        return this.#nudge(0, -step);
      case 'ArrowDown':
        return this.#nudge(0, step);
      case 'Enter':
      case ' ':
        if (this.#focus === null) return false;
        this.session.grab(this.#focus);
        this.#releaseHeld();
        return true;
      case 'q':
      case 'Q':
        return this.#rotateFocus(-SIXTY_DEGREES);
      case 'e':
      case 'E':
        return this.#rotateFocus(SIXTY_DEGREES);
      case 'f':
      case 'F':
        this.camera.fit(this.board.bounds, 1.15);
        return true;
      case 'g':
      case 'G':
        this.session.scatter();
        this.events.onStatus?.('Re-scattered the loose pieces.');
        return true;
      case 's':
      case 'S':
        this.edgeSort();
        return true;
      case 'h':
      case 'H':
        this.hint();
        return true;
      case '+':
      case '=':
        this.camera.zoomAbout({ x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 }, 1.2);
        return true;
      case '-':
        this.camera.zoomAbout({ x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 }, 1 / 1.2);
        return true;
      default:
        void pieces;
        return false;
    }
  }

  #cycleFocus(direction: number): void {
    const total = this.board.pieces.length;
    const start = this.#focus ?? (direction > 0 ? -1 : 0);
    for (let step = 1; step <= total; step++) {
      const candidate = (((start + direction * step) % total) + total) % total;
      // Skip pieces already welded into the same cluster as the previous focus, so Tab walks
      // between things you can actually still move rather than around one big blob.
      if (this.#focus === null || !this.session.clusters.areJoined(candidate, this.#focus)) {
        this.#focus = candidate;
        this.events.onFocusChange?.(candidate);
        return;
      }
    }
    this.#focus = start < 0 ? 0 : start;
    this.events.onFocusChange?.(this.#focus);
  }

  #nudge(dx: number, dy: number): boolean {
    if (this.#focus === null) return false;
    this.#touch(this.#focus);
    this.session.clusters.bringToFront(this.#focus);
    this.session.moveCluster(
      this.#focus,
      add(this.session.clusters.worldPosition(this.#focus), { x: dx, y: dy }),
    );
    return true;
  }

  #rotateFocus(delta: number): boolean {
    if (this.#focus === null) return false;
    if (!modeInfo(this.puzzle.mode).rotates) return false;
    this.session.clusters.rotateAbout(
      this.#focus,
      this.session.clusters.worldPosition(this.#focus),
      delta,
    );
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Assists

  /** Gather the border pieces into a ring around the board, the way a person sorts edges first. */
  edgeSort(): void {
    const border = this.board.pieces.filter((p) => p.isBorder);
    const size = {
      x: this.board.bounds.max.x - this.board.bounds.min.x,
      y: this.board.bounds.max.y - this.board.bounds.min.y,
    };
    const radius = Math.hypot(size.x, size.y) * 0.62;
    const centre = {
      x: (this.board.bounds.min.x + this.board.bounds.max.x) / 2,
      y: (this.board.bounds.min.y + this.board.bounds.max.y) / 2,
    };
    let placed = 0;
    for (const piece of border) {
      if (this.session.clusters.sizeOf(piece.index) > 1) continue;
      const angle = (placed / Math.max(1, border.length)) * Math.PI * 2;
      this.session.moveCluster(piece.index, {
        x: centre.x + Math.cos(angle) * radius,
        y: centre.y + Math.sin(angle) * radius,
      });
      placed++;
    }
    this.events.onStatus?.(`Gathered ${placed} edge pieces.`);
  }

  /**
   * Glow a pair of pieces that belong together.
   *
   * Picks the closest such pair on the board rather than a random one, so the hint is the move you
   * were most nearly making anyway.
   */
  hint(): number | null {
    let best: { piece: number; neighbour: number; gap: number } | null = null;
    for (const piece of this.board.pieces) {
      for (const neighbour of piece.neighbors) {
        if (neighbour === -1 || neighbour < piece.index) continue;
        if (this.session.clusters.areJoined(piece.index, neighbour)) continue;
        const gap = distance(
          this.session.clusters.worldPosition(piece.index),
          this.session.clusters.worldPosition(neighbour),
        );
        if (best === null || gap < best.gap) best = { piece: piece.index, neighbour, gap };
      }
    }
    if (best === null) return null;
    this.#focus = best.piece;
    this.events.onFocusChange?.(best.piece);
    this.audio.hint();
    this.events.onStatus?.(`Piece ${best.piece + 1} joins piece ${best.neighbour + 1}.`);
    return best.piece;
  }

  // -------------------------------------------------------------------------------------------
  // Gamepad

  #pollGamepad(dt: number): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const pad = navigator.getGamepads().find((p) => p !== null);
    if (pad === undefined || pad === null) return;

    const [rawX = 0, rawY = 0] = pad.axes;
    const dead = 0.18;
    const x = Math.abs(rawX) > dead ? rawX : 0;
    const y = Math.abs(rawY) > dead ? rawY : 0;
    if ((x !== 0 || y !== 0) && this.#focus !== null) {
      const speed = (520 * dt) / this.camera.zoom;
      this.#nudge(x * speed, y * speed);
    }

    const grab = pad.buttons[0]?.pressed === true;
    if (grab && !this.#gamepadGrabbed && this.#focus !== null) {
      this.session.grab(this.#focus);
    } else if (!grab && this.#gamepadGrabbed) {
      this.#releaseHeld();
    }
    this.#gamepadGrabbed = grab;

    if (pad.buttons[4]?.pressed === true) this.#cycleFocus(-1);
    if (pad.buttons[5]?.pressed === true) this.#cycleFocus(1);
  }

  // -------------------------------------------------------------------------------------------

  setPrefs(patch: Partial<Prefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    this.audio.setVolume(this.prefs.volume);
    this.persistence.savePrefs(this.prefs);
  }

  destroy(): void {
    this.pause();
    this.audio.close();
  }
}

/** Difficulty and mode helpers the UI needs without importing core directly. */
export { difficultyInfo, modeInfo };
export type { Difficulty, Mode };
