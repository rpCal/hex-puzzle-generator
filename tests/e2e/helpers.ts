import type { Page } from '@playwright/test';

/**
 * Shared e2e plumbing.
 *
 * The tests drive the game through the same API the game itself uses, exposed on `window.hexforge`.
 * That is deliberate: synthesising pointer events and hoping they land on the right pixel tests the
 * test's arithmetic more than it tests the game. Where the *input path* is what is under test — the
 * mouse solve, the keyboard solve — real events are used and only the coordinates come from the API.
 */

export interface BoardSnapshot {
  pieces: number;
  clusters: number;
  solved: boolean;
  fraction: number;
  code: string;
  elapsed: number;
}

/** Wait for the game to report that it started, and fail loudly if it reported anything else. */
export async function bootGame(page: Page, query = ''): Promise<void> {
  await page.goto(`./${query}`);
  await page.waitForFunction(() => document.body.dataset['hexforgeState'] !== undefined, null, {
    timeout: 45_000,
  });
  const state = await page.evaluate(() => document.body.dataset['hexforgeState']);
  if (state !== 'ready') {
    throw new Error(`game did not start: state=${state}`);
  }
  // One rendered frame, so the picking attachment has something in it.
  await page.waitForFunction(() => (globalThis as never as GameHandle).hexforge.app.frameTimes.length > 2);
}

export async function snapshot(page: Page): Promise<BoardSnapshot> {
  return page.evaluate(() => {
    const g = (globalThis as never as GameHandle).hexforge;
    const p = g.app.session.progress;
    return {
      pieces: p.pieces,
      clusters: p.clusters,
      solved: p.solved,
      fraction: p.fraction,
      code: g.app.puzzleCode,
      elapsed: g.app.session.elapsedSeconds,
    };
  });
}

/** CSS-pixel position of a piece's centre, and of where that piece currently belongs. */
export async function pieceScreenPositions(
  page: Page,
  piece: number,
): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  return page.evaluate((index) => {
    const g = (globalThis as never as GameHandle).hexforge;
    const app = g.app;
    const canvas = app.gpu.canvas;
    const rect = canvas.getBoundingClientRect();
    const toCss = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: rect.left + (p.x / canvas.width) * rect.width,
      y: rect.top + (p.y / canvas.height) * rect.height,
    });

    // Anchor on whichever cluster piece 0 is in, and aim for this piece's solved offset from it.
    const anchor = app.session.clusters.find(0);
    const anchorWorld = app.session.clusters.worldPosition(anchor);
    const solvedSelf = app.board.pieces[index]!.center;
    const solvedAnchor = app.board.pieces[anchor]!.center;
    const target = {
      x: anchorWorld.x + (solvedSelf.x - solvedAnchor.x),
      y: anchorWorld.y + (solvedSelf.y - solvedAnchor.y),
    };

    return {
      from: toCss(app.camera.worldToScreen(app.session.clusters.worldPosition(index))),
      to: toCss(app.camera.worldToScreen(target)),
    };
  }, piece);
}

/** Drag a piece from where it is to where it belongs, with real mouse events. */
export async function dragPieceHome(page: Page, piece: number): Promise<void> {
  const { from, to } = await pieceScreenPositions(page, piece);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  // Let the release resolve and a frame go by.
  await page.waitForTimeout(60);
}

/** Types for the handle `main.ts` exposes. Kept here so the tests stay type-checked. */
export interface GameHandle {
  hexforge: {
    app: {
      board: {
        pieces: { center: { x: number; y: number }; isBorder: boolean }[];
        uniqueEdges: unknown[];
      };
      session: {
        progress: { pieces: number; clusters: number; solved: boolean; fraction: number };
        clusters: {
          find(piece: number): number;
          worldPosition(piece: number): { x: number; y: number };
          count: number;
        };
        elapsedSeconds: number;
        scatter(): void;
      };
      camera: { worldToScreen(p: { x: number; y: number }): { x: number; y: number }; zoom: number };
      gpu: { canvas: HTMLCanvasElement };
      puzzleCode: string;
      focusedPiece: number | null;
      frameTimes: number[];
      handleKey(key: string, modifiers?: { shift?: boolean }): boolean;
    };
    hud: { exportPrint(page?: string): string };
    renderer: { triangleCount: number };
    gpu: { info: { isFallback: boolean; vendor: string; architecture: string } };
    solveInstantly(): void;
  };
}
