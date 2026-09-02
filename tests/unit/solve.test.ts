import { describe, it, expect } from 'vitest';
import { generateCut, type CutBoard } from '@core/cut/board.ts';
import { Clusters } from '@core/solve/clusters.ts';
import {
  angleDelta,
  applySnap,
  findSnaps,
  joinMidpoint,
  joinedEdgeCount,
  resolveSnaps,
  snapTolerance,
  type SnapConfig,
} from '@core/solve/snap.ts';
import { PuzzleSession } from '@core/board/session.ts';
import { Mode } from '@core/rules/presets.ts';
import { add, distance, rotate, sub, type Vec2 } from '@core/math/vec2.ts';

const RADIUS = 52;

const makeBoard = (rings = 2, seed = 31337): CutBoard =>
  generateCut({
    seed,
    shape: { kind: 'hex', rings },
    radius: RADIUS,
    tab: { tabSize: 0.16, jitter: 0.06 },
  });

const config = (over: Partial<SnapConfig> = {}): SnapConfig => ({
  radius: RADIUS,
  zoom: 1,
  rotationTolerance: Math.PI / 12,
  ...over,
});

describe('snapTolerance', () => {
  it('is constant in screen space: world tolerance shrinks as zoom grows', () => {
    // The whole point. If this were flat in world units, a zoomed-out board would solve itself.
    expect(snapTolerance(RADIUS, 1)).toBeCloseTo(0.28 * RADIUS, 9);
    expect(snapTolerance(RADIUS, 2)).toBeCloseTo(0.14 * RADIUS, 9);
    expect(snapTolerance(RADIUS, 0.5)).toBeGreaterThan(snapTolerance(RADIUS, 1));
  });

  it('is monotonically non-increasing in zoom', () => {
    let previous = Infinity;
    for (let zoom = 0.1; zoom <= 8; zoom += 0.1) {
      const t = snapTolerance(RADIUS, zoom);
      expect(t).toBeLessThanOrEqual(previous + 1e-12);
      previous = t;
    }
  });

  it('clamps at both ends so extreme zoom cannot break the game', () => {
    expect(snapTolerance(RADIUS, 1000)).toBeCloseTo(0.12 * RADIUS, 9);
    expect(snapTolerance(RADIUS, 0.0001)).toBeCloseTo(0.5 * RADIUS, 9);
  });

  it('survives a nonsensical zoom instead of returning NaN or Infinity', () => {
    expect(Number.isFinite(snapTolerance(RADIUS, 0))).toBe(true);
    expect(Number.isFinite(snapTolerance(RADIUS, -3))).toBe(true);
  });
});

describe('angleDelta', () => {
  it('returns the short way round', () => {
    expect(angleDelta(0, 0.5)).toBeCloseTo(0.5, 12);
    expect(angleDelta(0, -0.5)).toBeCloseTo(-0.5, 12);
    expect(angleDelta(0, Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 12);
    expect(angleDelta(Math.PI * 2 - 0.1, 0)).toBeCloseTo(0.1, 12);
  });

  it('stays within (-pi, pi]', () => {
    for (let i = 0; i < 1000; i++) {
      const a = (i / 1000) * 20 - 10;
      const b = ((i * 7) / 1000) * 20 - 10;
      const d = angleDelta(a, b);
      expect(d).toBeGreaterThan(-Math.PI - 1e-9);
      expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('Clusters', () => {
  it('starts with every piece in its own cluster at its solved position', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    expect(clusters.count).toBe(board.pieces.length);
    for (const piece of board.pieces) {
      expect(clusters.find(piece.index)).toBe(piece.index);
      expect(clusters.worldPosition(piece.index)).toEqual(piece.center);
      expect(clusters.sizeOf(piece.index)).toBe(1);
    }
  });

  it('moves every member when the cluster moves', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    clusters.merge(0, 1);
    const before = [0, 1].map((i) => clusters.worldPosition(i));
    clusters.translate(0, { x: 100, y: -40 });
    const after = [0, 1].map((i) => clusters.worldPosition(i));
    for (let i = 0; i < 2; i++) {
      expect(after[i]!.x).toBeCloseTo(before[i]!.x + 100, 9);
      expect(after[i]!.y).toBeCloseTo(before[i]!.y - 40, 9);
    }
  });

  it('keeps members rigid under rotation', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    clusters.merge(0, 1);
    const gapBefore = distance(clusters.worldPosition(0), clusters.worldPosition(1));
    clusters.rotateAbout(0, clusters.worldPosition(0), 1.1);
    const gapAfter = distance(clusters.worldPosition(0), clusters.worldPosition(1));
    expect(gapAfter).toBeCloseTo(gapBefore, 9);
  });

  it('rotateAbout keeps the pivot fixed', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    clusters.merge(0, 1);
    const pivot = clusters.worldPosition(1);
    clusters.rotateAbout(0, pivot, 0.77);
    expect(distance(clusters.worldPosition(1), pivot)).toBeLessThan(1e-9);
  });

  it('merge is idempotent for already-joined pieces', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    expect(clusters.merge(0, 1)).not.toBe(-1);
    expect(clusters.merge(0, 1)).toBe(-1);
    expect(clusters.count).toBe(board.pieces.length - 1);
  });

  it('merges transitively', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    clusters.merge(0, 1);
    clusters.merge(1, 2);
    expect(clusters.areJoined(0, 2)).toBe(true);
    expect(clusters.sizeOf(2)).toBe(3);
    expect(clusters.membersOf(0)).toEqual([0, 1, 2]);
  });

  it('brings a cluster to the front', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const before = clusters.zOf(3);
    clusters.bringToFront(3);
    expect(clusters.zOf(3)).toBeGreaterThan(before);
    clusters.bringToFront(5);
    expect(clusters.zOf(5)).toBeGreaterThan(clusters.zOf(3));
  });

  it('round-trips through serialize/restore', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    clusters.merge(0, 1);
    clusters.merge(2, 3);
    clusters.translate(0, { x: 12, y: 34 });
    clusters.setRotation(2, 0.9);
    const snapshot = clusters.serialize();

    const restored = new Clusters(board.pieces.map((p) => p.center));
    expect(restored.restore(snapshot)).toBe(true);
    expect(restored.count).toBe(clusters.count);
    for (const piece of board.pieces) {
      expect(restored.find(piece.index)).toBe(clusters.find(piece.index));
      expect(distance(restored.worldPosition(piece.index), clusters.worldPosition(piece.index))).toBeLessThan(1e-9);
    }
  });

  it('rejects a snapshot from a different board size', () => {
    const clusters = new Clusters(makeBoard(1).pieces.map((p) => p.center));
    const other = new Clusters(makeBoard(2).pieces.map((p) => p.center));
    expect(clusters.restore(other.serialize())).toBe(false);
  });

  it('worldTransform agrees with worldPosition and worldRotation', () => {
    const board = makeBoard();
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    clusters.merge(0, 1);
    clusters.setRotation(0, 0.6);
    clusters.translate(0, { x: 5, y: 7 });
    for (const i of [0, 1]) {
      const m = clusters.worldTransform(i);
      expect(m.tx).toBeCloseTo(clusters.worldPosition(i).x, 9);
      expect(m.ty).toBeCloseTo(clusters.worldPosition(i).y, 9);
      expect(Math.atan2(m.b, m.a)).toBeCloseTo(clusters.worldRotation(i), 9);
    }
  });
});

describe('findSnaps', () => {
  const board = makeBoard(2);

  const scatterAllAway = (clusters: Clusters): void => {
    for (let i = 0; i < board.pieces.length; i++) {
      clusters.setPosition(i, { x: 10_000 + i * 500, y: 10_000 });
    }
  };

  it('accepts a neighbour placed exactly right', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    scatterAllAway(clusters);
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    clusters.setPosition(b, { x: 0, y: 0 });
    clusters.setPosition(a, sub(board.pieces[a]!.center, board.pieces[b]!.center));

    const found = findSnaps(board, clusters, a, config());
    expect(found.some((c) => c.neighbor === b)).toBe(true);
  });

  it('rejects a neighbour just outside tolerance and accepts one just inside', () => {
    const tolerance = snapTolerance(RADIUS, 1);
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;

    const place = (offset: number): boolean => {
      const clusters = new Clusters(board.pieces.map((p) => p.center));
      scatterAllAway(clusters);
      clusters.setPosition(b, { x: 0, y: 0 });
      clusters.setPosition(a, add(sub(board.pieces[a]!.center, board.pieces[b]!.center), { x: offset, y: 0 }));
      return findSnaps(board, clusters, a, config()).some((c) => c.neighbor === b);
    };

    expect(place(tolerance * 0.99)).toBe(true);
    expect(place(tolerance * 1.01)).toBe(false);
  });

  it('respects the tolerance change caused by zoom', () => {
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    const offset = snapTolerance(RADIUS, 1) * 0.9;

    const attempt = (zoom: number): boolean => {
      const clusters = new Clusters(board.pieces.map((p) => p.center));
      scatterAllAway(clusters);
      clusters.setPosition(b, { x: 0, y: 0 });
      clusters.setPosition(a, add(sub(board.pieces[a]!.center, board.pieces[b]!.center), { x: offset, y: 0 }));
      return findSnaps(board, clusters, a, config({ zoom })).some((c) => c.neighbor === b);
    };

    expect(attempt(1)).toBe(true);
    // Zoomed in 4x, the same world offset is four times as many pixels of error.
    expect(attempt(4)).toBe(false);
  });

  it('rejects a correctly placed but wrongly rotated neighbour', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    scatterAllAway(clusters);
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    clusters.setPosition(b, { x: 0, y: 0 });
    clusters.setPosition(a, sub(board.pieces[a]!.center, board.pieces[b]!.center));
    clusters.setRotation(a, Math.PI / 3);

    expect(findSnaps(board, clusters, a, config()).some((c) => c.neighbor === b)).toBe(false);
  });

  it('never proposes a snap between pieces already in the same cluster', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    clusters.merge(a, b);
    expect(findSnaps(board, clusters, a, config()).some((c) => c.neighbor === b)).toBe(false);
  });

  it('sorts candidates by error, closest first', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const found = findSnaps(board, clusters, 0, config());
    for (let i = 1; i < found.length; i++) {
      expect(found[i]!.error).toBeGreaterThanOrEqual(found[i - 1]!.error);
    }
  });
});

describe('applySnap', () => {
  const board = makeBoard(2);

  it('aligns exactly, not approximately', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    clusters.setPosition(a, add(board.pieces[a]!.center, { x: 4, y: -3 }));

    const candidate = findSnaps(board, clusters, a, config()).find((c) => c.neighbor === b);
    expect(candidate).toBeDefined();
    applySnap(board, clusters, candidate!);

    // After the weld the relative offset must equal the solved offset to float precision.
    const observed = sub(clusters.worldPosition(a), clusters.worldPosition(b));
    const expected = sub(board.pieces[a]!.center, board.pieces[b]!.center);
    expect(distance(observed, expected)).toBeLessThan(1e-9);
  });

  it('joins the two clusters', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    const candidate = findSnaps(board, clusters, a, config()).find((c) => c.neighbor === b)!;
    expect(applySnap(board, clusters, candidate)).not.toBe(-1);
    expect(clusters.areJoined(a, b)).toBe(true);
  });

  it('returns -1 without changing anything when already joined', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const a = 0;
    const b = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    const candidate = findSnaps(board, clusters, a, config()).find((c) => c.neighbor === b)!;
    applySnap(board, clusters, candidate);
    const countBefore = clusters.count;
    expect(applySnap(board, clusters, candidate)).toBe(-1);
    expect(clusters.count).toBe(countBefore);
  });

  it('carries the moved cluster along, not just the grabbed piece', () => {
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    // Build a two-piece cluster far from home, then snap it back.
    const a = 0;
    const partner = board.pieces[a]!.neighbors.find((n) => n !== -1) as number;
    const target = board.pieces[a]!.neighbors.find((n) => n !== -1 && n !== partner) as number;

    const first = findSnaps(board, clusters, a, config()).find((c) => c.neighbor === partner)!;
    applySnap(board, clusters, first);
    clusters.translate(a, { x: 300, y: 300 });
    expect(clusters.sizeOf(a)).toBe(2);

    clusters.translate(a, { x: -300, y: -300 });
    const second = findSnaps(board, clusters, a, config()).find((c) => c.neighbor === target)!;
    applySnap(board, clusters, second);
    expect(clusters.sizeOf(a)).toBe(3);
    // The partner must have travelled with it and still be correctly placed.
    const observed = sub(clusters.worldPosition(partner), clusters.worldPosition(a));
    const expected = sub(board.pieces[partner]!.center, board.pieces[a]!.center);
    expect(distance(observed, expected)).toBeLessThan(1e-9);
  });
});

describe('resolveSnaps cascades', () => {
  it('welds every neighbour reachable in one drop', () => {
    const board = makeBoard(1);
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    // Everything already at solved positions: dropping the centre should absorb all six.
    const centre = board.pieces.findIndex((p) => !p.isBorder);
    const result = resolveSnaps(board, clusters, centre, config());
    expect(result.joins.length).toBeGreaterThanOrEqual(6);
    expect(result.solved).toBe(true);
    expect(clusters.count).toBe(1);
  });

  it('terminates on a board that cannot snap any further', () => {
    const board = makeBoard(2);
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    for (let i = 0; i < board.pieces.length; i++) {
      clusters.setPosition(i, { x: i * 5000, y: 0 });
    }
    const result = resolveSnaps(board, clusters, 0, config());
    expect(result.joins).toHaveLength(0);
    expect(result.solved).toBe(false);
  });
});

describe('joinMidpoint', () => {
  it('lands on the shared edge, between the two piece centres', () => {
    const board = makeBoard(2);
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const a = 0;
    const b = board.pieces[a]!.neighbors.findIndex((n) => n !== -1);
    const neighborIndex = board.pieces[a]!.neighbors[b] as number;
    const candidate = { piece: a, neighbor: neighborIndex, edge: b, error: 0, angleError: 0 };

    const mid = joinMidpoint(board, clusters, candidate);
    const pa = clusters.worldPosition(a);
    const pb = clusters.worldPosition(neighborIndex);
    // The edge midpoint sits about half a hex from each centre.
    expect(distance(mid, pa)).toBeLessThan(RADIUS);
    expect(distance(mid, pb)).toBeLessThan(RADIUS);
  });

  it('follows the cluster when it is rotated', () => {
    const board = makeBoard(2);
    const clusters = new Clusters(board.pieces.map((p) => p.center));
    const candidate = { piece: 0, neighbor: 1, edge: 0, error: 0, angleError: 0 };
    const before = joinMidpoint(board, clusters, candidate);
    const pivot = clusters.worldPosition(0);
    clusters.rotateAbout(0, pivot, Math.PI / 2);
    const after = joinMidpoint(board, clusters, candidate);
    const expected = add(pivot, rotate(sub(before, pivot), Math.PI / 2));
    expect(distance(after, expected)).toBeLessThan(1e-9);
  });
});

describe('PuzzleSession', () => {
  it('scatters every piece clear of the assembled area', () => {
    const board = makeBoard(2);
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 7 });
    session.scatter();
    const centre = { x: 0, y: 0 };
    for (let i = 0; i < board.pieces.length; i++) {
      expect(distance(session.clusters.worldPosition(i), centre)).toBeGreaterThan(RADIUS);
    }
  });

  it('scatters deterministically for a given seed', () => {
    const board = makeBoard(2);
    const a = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 99 });
    const b = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 99 });
    a.scatter();
    b.scatter();
    for (let i = 0; i < board.pieces.length; i++) {
      expect(a.clusters.worldPosition(i)).toEqual(b.clusters.worldPosition(i));
    }
  });

  it('rotates pieces only in modes that ask for it', () => {
    const board = makeBoard(2);
    const plain = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 3 });
    plain.scatter();
    for (let i = 0; i < board.pieces.length; i++) {
      expect(plain.clusters.worldRotation(i)).toBe(0);
    }

    const spun = new PuzzleSession(board, { mode: Mode.Rotation, scatterSeed: 3 });
    spun.scatter();
    const rotations = new Set<number>();
    for (let i = 0; i < board.pieces.length; i++) rotations.add(spun.clusters.worldRotation(i));
    expect(rotations.size).toBeGreaterThan(1);
    for (const r of rotations) {
      expect((r / (Math.PI / 3)) % 1).toBeCloseTo(0, 9);
    }
  });

  /**
   * The Phase 3 exit criterion: the entire game is playable with no GPU and no DOM.
   */
  it('can be solved end to end by dragging pieces home', () => {
    const board = makeBoard(3);
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 5 });
    session.scatter();
    expect(session.isSolved).toBe(false);
    expect(session.progress.fraction).toBe(0);

    // Drag each piece to where it belongs relative to the growing assembly.
    for (let i = 0; i < board.pieces.length; i++) {
      const anchorPiece = session.clusters.find(0);
      const anchorWorld = session.clusters.worldPosition(anchorPiece);
      const solvedOffset = sub(board.pieces[i]!.center, board.pieces[anchorPiece]!.center);
      const target = add(anchorWorld, solvedOffset);

      session.grab(i, session.clusters.worldPosition(i));
      session.dragTo(target);
      session.release();
    }

    expect(session.isSolved).toBe(true);
    expect(session.progress.fraction).toBe(1);
    expect(session.clusters.count).toBe(1);
    expect(joinedEdgeCount(board, session.clusters)).toBeGreaterThan(0);
  });

  it('reports progress monotonically as pieces go home', () => {
    const board = makeBoard(2);
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 11 });
    session.scatter();
    let previous = -1;
    for (let i = 0; i < board.pieces.length; i++) {
      const anchorPiece = session.clusters.find(0);
      const target = add(
        session.clusters.worldPosition(anchorPiece),
        sub(board.pieces[i]!.center, board.pieces[anchorPiece]!.center),
      );
      session.grab(i, session.clusters.worldPosition(i));
      session.dragTo(target);
      session.release();
      const fraction = session.progress.fraction;
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
    expect(previous).toBe(1);
  });

  it('solveInstantly reaches a solved board', () => {
    const board = makeBoard(3);
    const session = new PuzzleSession(board, { mode: Mode.Zen, scatterSeed: 1 });
    session.scatter();
    session.solveInstantly();
    expect(session.isSolved).toBe(true);
    expect(session.progress.joinedEdges).toBe(session.progress.totalEdges);
  });

  it('runs the clock in timed modes and not in Zen', () => {
    const board = makeBoard(1);
    const timed = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 1 });
    timed.scatter();
    timed.grab(0);
    timed.tick(5);
    expect(timed.elapsedSeconds).toBe(5);

    const zen = new PuzzleSession(board, { mode: Mode.Zen, scatterSeed: 1 });
    zen.scatter();
    zen.grab(0);
    zen.tick(5);
    expect(zen.elapsedSeconds).toBe(0);
  });

  it('does not start the clock before the first interaction', () => {
    const session = new PuzzleSession(makeBoard(1), { mode: Mode.Classic, scatterSeed: 1 });
    session.scatter();
    session.tick(10);
    expect(session.elapsedSeconds).toBe(0);
  });

  it('stops the clock once solved', () => {
    const session = new PuzzleSession(makeBoard(1), { mode: Mode.Classic, scatterSeed: 1 });
    session.solveInstantly();
    session.tick(10);
    expect(session.elapsedSeconds).toBe(0);
    expect(session.isRunning).toBe(false);
  });

  it('ignores a grab on a piece that does not exist', () => {
    const session = new PuzzleSession(makeBoard(1), { mode: Mode.Classic, scatterSeed: 1 });
    session.grab(-1);
    session.grab(9999);
    expect(session.heldPiece).toBeNull();
  });

  it('release with nothing held is a no-op', () => {
    const session = new PuzzleSession(makeBoard(1), { mode: Mode.Classic, scatterSeed: 1 });
    const result = session.release();
    expect(result.joins).toHaveLength(0);
    expect(result.cluster).toBe(-1);
  });

  it('only rotates in modes that rotate', () => {
    const board = makeBoard(1);
    const plain = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 1 });
    plain.grab(0);
    plain.rotateHeld(1);
    expect(plain.clusters.worldRotation(0)).toBe(0);

    const spun = new PuzzleSession(board, { mode: Mode.Rotation, scatterSeed: 1 });
    spun.grab(0);
    spun.rotateHeld(Math.PI / 3);
    expect(spun.clusters.worldRotation(0)).toBeCloseTo(Math.PI / 3, 9);
  });

  it('restores a partially solved board exactly', () => {
    const board = makeBoard(2);
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 21 });
    session.scatter();
    for (let i = 0; i < 5; i++) {
      const anchorPiece = session.clusters.find(0);
      session.grab(i);
      session.dragTo(
        add(
          session.clusters.worldPosition(anchorPiece),
          sub(board.pieces[i]!.center, board.pieces[anchorPiece]!.center),
        ),
      );
      session.release();
    }
    session.tick(42);
    const snapshot = session.serialize();

    const restored = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 21 });
    expect(restored.restore(snapshot)).toBe(true);
    expect(restored.elapsedSeconds).toBe(session.elapsedSeconds);
    expect(restored.progress).toEqual(session.progress);
    for (let i = 0; i < board.pieces.length; i++) {
      expect(
        distance(restored.clusters.worldPosition(i), session.clusters.worldPosition(i)),
      ).toBeLessThan(1e-9);
    }
  });

  it('refuses a snapshot from a different board', () => {
    const session = new PuzzleSession(makeBoard(1), { mode: Mode.Classic, scatterSeed: 1 });
    const other = new PuzzleSession(makeBoard(3), { mode: Mode.Classic, scatterSeed: 1 });
    expect(session.restore(other.serialize())).toBe(false);
  });

  it('moveCluster places a cluster directly', () => {
    const board = makeBoard(1);
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 1 });
    const to: Vec2 = { x: 123, y: -456 };
    session.moveCluster(2, to);
    expect(distance(session.clusters.worldPosition(2), to)).toBeLessThan(1e-9);
  });
});
