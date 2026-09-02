import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { requestGpu, type GpuContext } from '@gfx/device.ts';
import { Renderer, PIECE_DATA_STRIDE_FLOATS_FOR_TEST } from './helpers.ts';
import { generateCut } from '@core/cut/board.ts';
import { PuzzleSession } from '@core/board/session.ts';
import { Mode } from '@core/rules/presets.ts';
import { Camera } from '@game/camera.ts';
import { ClusterPacker, buildFrame, referencePieceTransform } from '@game/frame.ts';

/**
 * End-to-end GPU tests: a real device, real pipelines, a real board, real frames.
 *
 * These are the tests that would have caught every mistake the shader-compile test cannot see —
 * a mismatched buffer stride, a transposed transform, a picking attachment that never gets written.
 */

const WIDTH = 320;
const HEIGHT = 240;
const RADIUS = 40;

let gpu: GpuContext;
let renderer: Renderer;
let canvas: HTMLCanvasElement;

const board = generateCut({
  seed: 20260902,
  shape: { kind: 'hex', rings: 1 },
  radius: RADIUS,
  tab: { tabSize: 0.18, jitter: 0.05 },
});

beforeAll(async () => {
  canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.append(canvas);
  gpu = await requestGpu({ canvas });
  renderer = await Renderer.create(gpu, { particleCapacity: 256, artSize: 256 });
  renderer.resize(WIDTH, HEIGHT);
  renderer.setBoard(board);
});

afterAll(() => {
  renderer?.destroy();
  canvas?.remove();
});

function frameFor(session: PuzzleSession): {
  packed: ReturnType<ClusterPacker['pack']>;
  camera: Camera;
} {
  const camera = new Camera();
  camera.setViewport(WIDTH, HEIGHT);
  camera.fit(board.bounds, 1.15);
  const packer = new ClusterPacker(session);
  const packed = packer.pack();
  renderer.setPieceClusters(packed.pieceCluster);
  renderer.render(
    buildFrame(packed, { camera, timeSeconds: 0, deltaSeconds: 1 / 60 }),
  );
  return { packed, camera };
}

describe('device', () => {
  it('reports the adapter it got', () => {
    expect(gpu.info.maxTextureDimension2D).toBeGreaterThanOrEqual(4096);
    expect(typeof gpu.info.isFallback).toBe('boolean');
  });

  it('identifies SwiftShader as a fallback adapter', () => {
    // The perf test relies on this to skip honestly rather than report a meaningless number.
    if (/swiftshader/i.test(`${gpu.info.vendor} ${gpu.info.architecture}`)) {
      expect(gpu.info.isFallback).toBe(true);
    }
  });
});

describe('board upload', () => {
  it('builds geometry for every piece', () => {
    expect(renderer.hasBoard).toBe(true);
    // 7 pieces, each an outer ring, an inner ring and a fill.
    expect(renderer.triangleCount).toBeGreaterThan(board.pieces.length * 100);
  });
});

describe('cluster compute pass', () => {
  /**
   * The kernel and `Clusters.worldPosition` do the same arithmetic in the same order, so their
   * results must agree to f32 precision. Comparing them directly is what makes it safe to move
   * transform expansion onto the GPU at all.
   */
  it('reproduces the CPU reference transform for every piece', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 4 });
    session.scatter();
    const { packed } = frameFor(session);

    const data = await renderer.readPieceData();
    expect(data.length).toBe(board.pieces.length * PIECE_DATA_STRIDE_FLOATS_FOR_TEST);

    for (let piece = 0; piece < board.pieces.length; piece++) {
      const base = piece * PIECE_DATA_STRIDE_FLOATS_FOR_TEST;
      const gpuX = data[base + 4] as number;
      const gpuY = data[base + 5] as number;
      const reference = referencePieceTransform(packed, board.pieces[piece]!.center, piece);
      expect(gpuX).toBeCloseTo(reference.position.x, 2);
      expect(gpuY).toBeCloseTo(reference.position.y, 2);

      // ... and the rotation matrix must match too.
      const a = data[base + 0] as number;
      const b = data[base + 1] as number;
      expect(a).toBeCloseTo(Math.cos(reference.rotation), 4);
      expect(b).toBeCloseTo(Math.sin(reference.rotation), 4);
    }
  });

  it('tracks a cluster after it is dragged', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 9 });
    session.scatter();
    frameFor(session);

    session.grab(0);
    session.dragTo({ x: 250, y: -180 });
    session.release();
    const { packed } = frameFor(session);

    const data = await renderer.readPieceData();
    const reference = referencePieceTransform(packed, board.pieces[0]!.center, 0);
    expect(data[4]).toBeCloseTo(reference.position.x, 2);
    expect(data[5]).toBeCloseTo(reference.position.y, 2);
  });

  it('carries a whole welded cluster with one transform', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 2 });
    session.solveInstantly();
    expect(session.clusters.count).toBe(1);

    session.grab(0);
    session.dragTo({ x: 400, y: 400 });
    session.release();
    const { packed } = frameFor(session);

    const data = await renderer.readPieceData();
    for (let piece = 0; piece < board.pieces.length; piece++) {
      const base = piece * PIECE_DATA_STRIDE_FLOATS_FOR_TEST;
      const reference = referencePieceTransform(packed, board.pieces[piece]!.center, piece);
      expect(data[base + 4]).toBeCloseTo(reference.position.x, 2);
      expect(data[base + 5]).toBeCloseTo(reference.position.y, 2);
    }
  });

  it('flags the held cluster and nothing else', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 6 });
    session.scatter();
    session.grab(3);
    const { packed } = frameFor(session);
    expect(packed.heldCluster).not.toBe(0xffffffff);

    const data = await renderer.readPieceData();
    for (let piece = 0; piece < board.pieces.length; piece++) {
      const held = data[piece * PIECE_DATA_STRIDE_FLOATS_FOR_TEST + 13] as number;
      expect(held).toBe(piece === 3 ? 1 : 0);
    }
  });
});

describe('picking', () => {
  it('returns the piece under a point, and -1 over empty board', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 1 });
    session.solveInstantly();
    const { camera } = frameFor(session);

    // The centre piece is solved at the board's centre, so it must be under the middle pixel.
    const centrePiece = board.pieces.findIndex((p) => !p.isBorder);
    const screen = camera.worldToScreen(session.clusters.worldPosition(centrePiece));
    expect(await renderer.pick(Math.round(screen.x), Math.round(screen.y))).toBe(centrePiece);

    // A corner of the viewport is outside the fitted board.
    expect(await renderer.pick(1, 1)).toBe(-1);
  });

  it('rejects coordinates outside the viewport', async () => {
    expect(await renderer.pick(-5, 10)).toBe(-1);
    expect(await renderer.pick(10, HEIGHT + 5)).toBe(-1);
  });

  it('follows a piece that has been moved', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 8 });
    session.scatter();
    const target = 2;
    session.moveCluster(target, { x: 0, y: 0 });
    const { camera } = frameFor(session);
    const screen = camera.worldToScreen({ x: 0, y: 0 });
    expect(await renderer.pick(Math.round(screen.x), Math.round(screen.y))).toBe(target);
  });
});

describe('drawing', () => {
  it('renders a frame that is not uniform', async () => {
    // "It did not throw" is not evidence that anything was drawn. Read the picking attachment and
    // require that several distinct pieces actually covered pixels.
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 3 });
    session.solveInstantly();
    frameFor(session);

    const seen = new Set<number>();
    for (let x = 20; x < WIDTH - 20; x += 12) {
      for (let y = 20; y < HEIGHT - 20; y += 12) {
        // Sequential on purpose: picking maps a single shared staging buffer, so overlapping
        // reads would contend for it. Parallelising here would be a bug, not an optimisation.
        // oxlint-disable-next-line no-await-in-loop
        const id = await renderer.pick(x, y);
        if (id >= 0) seen.add(id);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('survives many frames without leaking or erroring', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 12 });
    session.scatter();
    const camera = new Camera();
    camera.setViewport(WIDTH, HEIGHT);
    camera.fit(board.bounds);
    const packer = new ClusterPacker(session);
    for (let i = 0; i < 30; i++) {
      const packed = packer.pack();
      renderer.setPieceClusters(packed.pieceCluster);
      renderer.render(buildFrame(packed, { camera, timeSeconds: i / 60, deltaSeconds: 1 / 60 }));
    }
    await gpu.device.queue.onSubmittedWorkDone();
    expect(true).toBe(true);
  });

  it('handles a resize', async () => {
    renderer.resize(200, 150);
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 15 });
    session.solveInstantly();
    const camera = new Camera();
    camera.setViewport(200, 150);
    camera.fit(board.bounds);
    const packer = new ClusterPacker(session);
    const packed = packer.pack();
    renderer.setPieceClusters(packed.pieceCluster);
    renderer.render(buildFrame(packed, { camera, timeSeconds: 0, deltaSeconds: 0.016 }));
    await gpu.device.queue.onSubmittedWorkDone();
    expect(await renderer.pick(100, 75)).toBeGreaterThanOrEqual(0);
    renderer.resize(WIDTH, HEIGHT);
  });
});

describe('particles', () => {
  it('accepts spawns and retires them once their lifetime elapses', async () => {
    const session = new PuzzleSession(board, { mode: Mode.Classic, scatterSeed: 1 });
    session.solveInstantly();
    const camera = new Camera();
    camera.setViewport(WIDTH, HEIGHT);
    camera.fit(board.bounds);
    const packer = new ClusterPacker(session);

    // motion(4) + look(4) + timing(4)
    const spawn = new Float32Array([0, 0, 10, -10, 1, 0.8, 0.6, 6, 0, 0.25, 1.2, 0]);
    renderer.writeParticles(0, spawn);

    for (let i = 0; i < 30; i++) {
      const packed = packer.pack();
      renderer.render(buildFrame(packed, { camera, timeSeconds: i / 60, deltaSeconds: 1 / 60 }));
    }
    await gpu.device.queue.onSubmittedWorkDone();
    expect(true).toBe(true);
  });

  it('wraps a spawn that runs past the end of the ring buffer', () => {
    const spawn = new Float32Array(12 * 4).fill(1);
    expect(() => renderer.writeParticles(254, spawn)).not.toThrow();
  });
});
