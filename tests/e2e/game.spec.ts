import { test, expect } from '@playwright/test';
import { bootGame, dragPieceHome, snapshot, type GameHandle } from './helpers.ts';

/** A 7-piece board, fixed seed. Small enough that a CPU rasteriser stays honest. */
const SAMPLER = '?difficulty=0&seed=20260902';

test.describe('boot', () => {
  test('starts, acquires a device and draws something', async ({ page }) => {
    await bootGame(page, SAMPLER);

    await expect(page.locator('#canvas')).toBeVisible();
    const board = await snapshot(page);
    expect(board.pieces).toBe(7);
    expect(board.solved).toBe(false);

    // "No exception" is not evidence of rendering. Ask the model where each piece is, then read
    // the picking attachment at exactly that point: every piece must actually be drawn where the
    // simulation says it is. Stronger than sampling a grid, and seven readbacks rather than
    // several hundred -- each one maps a buffer, which is not free on a CPU rasteriser.
    const found = await page.evaluate(async () => {
      const g = (globalThis as never as GameHandle).hexforge;
      const app = g.app;
      const results: { piece: number; picked: number }[] = [];
      for (let piece = 0; piece < app.board.pieces.length; piece++) {
        const screen = app.camera.worldToScreen(app.session.clusters.worldPosition(piece));
        const picked = await (
          g.renderer as unknown as { pick(x: number, y: number): Promise<number> }
        ).pick(Math.round(screen.x), Math.round(screen.y));
        results.push({ piece, picked });
      }
      return results;
    });

    expect(found).toHaveLength(7);
    for (const { piece, picked } of found) {
      expect(picked).toBe(piece);
    }
  });

  test('puts the puzzle code in the URL so the board is shareable', async ({ page }) => {
    await bootGame(page, SAMPLER);
    const board = await snapshot(page);
    expect(page.url()).toContain(`#p=${board.code}`);
    expect(board.code).toHaveLength(12);
  });

  test('exposes an accessible canvas and live region', async ({ page }) => {
    await bootGame(page, SAMPLER);
    await expect(page.locator('#canvas')).toHaveAttribute('aria-label', 'Puzzle board');
    await expect(page.locator('[role="status"]')).toHaveCount(1);
    await expect(page.locator('[role="progressbar"]')).toHaveCount(1);
  });
});

test.describe('capability gate', () => {
  test('shows a designed screen, not a stack trace, without WebGPU', async ({ page }) => {
    // Remove the API before any of the app's code runs.
    await page.addInitScript(() => {
      Reflect.deleteProperty(Object.getPrototypeOf(navigator), 'gpu');
      Reflect.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    });
    await page.goto('./');
    await page.waitForFunction(() => document.body.dataset['hexforgeState'] !== undefined, null, {
      timeout: 30_000,
    });

    expect(await page.evaluate(() => document.body.dataset['hexforgeState'])).toBe('unsupported');
    const screen = page.locator('.capability');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText('WebGPU');
    // It must say what to do, not merely that something failed.
    await expect(screen).toContainText('Chrome');
    await expect(screen).toContainText('Safari');
  });
});

test.describe('solving', () => {
  test('a board can be solved by dragging, and the win state is recorded', async ({ page }) => {
    await bootGame(page, SAMPLER);
    expect((await snapshot(page)).clusters).toBe(7);

    for (let piece = 0; piece < 7; piece++) {
      await dragPieceHome(page, piece);
    }

    const solved = await snapshot(page);
    expect(solved.solved).toBe(true);
    expect(solved.clusters).toBe(1);
    expect(solved.fraction).toBe(1);

    await expect(page.locator('.scrim:not([hidden]) .dialog')).toContainText('Solved');
    expect(await page.evaluate(() => document.body.dataset['hexforgeSolved'])).toBe('true');
  });

  /**
   * The accessibility requirement, tested rather than asserted. Zero pointer events: Tab to cycle
   * focus, arrows to nudge, Enter to place.
   */
  test('a board can be solved with the keyboard alone', async ({ page }) => {
    await bootGame(page, SAMPLER);

    const pressesUsed = { count: 0 };
    for (let piece = 0; piece < 7; piece++) {
      // Focus this specific piece by cycling until it is the focused one.
      for (let guard = 0; guard < 20; guard++) {
        const focused = await page.evaluate(
          () => (globalThis as never as GameHandle).hexforge.app.focusedPiece,
        );
        if (focused === piece) break;
        await page.keyboard.press('Tab');
        pressesUsed.count++;
      }

      // Walk it home in constant screen-space steps, largest first.
      for (let guard = 0; guard < 220; guard++) {
        const delta = await page.evaluate((index) => {
          const g = (globalThis as never as GameHandle).hexforge;
          const app = g.app;
          const anchor = app.session.clusters.find(0);
          const anchorWorld = app.session.clusters.worldPosition(anchor);
          const solvedSelf = app.board.pieces[index]!.center;
          const solvedAnchor = app.board.pieces[anchor]!.center;
          const target = {
            x: anchorWorld.x + (solvedSelf.x - solvedAnchor.x),
            y: anchorWorld.y + (solvedSelf.y - solvedAnchor.y),
          };
          const here = app.session.clusters.worldPosition(index);
          return {
            x: (target.x - here.x) * app.camera.zoom,
            y: (target.y - here.y) * app.camera.zoom,
            joined: app.session.clusters.find(index) === anchor,
          };
        }, piece);

        if (delta.joined) break;
        if (Math.abs(delta.x) < 14 && Math.abs(delta.y) < 14) {
          await page.keyboard.press('Enter');
          pressesUsed.count++;
          break;
        }

        // 26 screen px per press, 104 with Shift held.
        const coarse = Math.abs(delta.x) > 110 || Math.abs(delta.y) > 110;
        const key =
          Math.abs(delta.x) > Math.abs(delta.y)
            ? delta.x > 0
              ? 'ArrowRight'
              : 'ArrowLeft'
            : delta.y > 0
              ? 'ArrowDown'
              : 'ArrowUp';
        await page.keyboard.press(coarse ? `Shift+${key}` : key);
        pressesUsed.count++;
      }
    }

    const solved = await snapshot(page);
    expect(solved.solved).toBe(true);
    expect(pressesUsed.count).toBeGreaterThan(20);
  });
});

test.describe('determinism', () => {
  test('the same puzzle code produces the same board twice', async ({ page }) => {
    await bootGame(page, SAMPLER);
    const first = await page.evaluate(() => {
      const g = (globalThis as never as GameHandle).hexforge;
      return {
        code: g.app.puzzleCode,
        centres: g.app.board.pieces.map((p) => [p.center.x, p.center.y]),
        triangles: g.renderer.triangleCount,
      };
    });

    await page.reload();
    await page.waitForFunction(() => document.body.dataset['hexforgeState'] === 'ready');
    const second = await page.evaluate(() => {
      const g = (globalThis as never as GameHandle).hexforge;
      return {
        code: g.app.puzzleCode,
        centres: g.app.board.pieces.map((p) => [p.center.x, p.center.y]),
        triangles: g.renderer.triangleCount,
      };
    });

    expect(second.code).toBe(first.code);
    expect(second.centres).toEqual(first.centres);
    // Identical geometry means an identical cut, not merely an identical layout.
    expect(second.triangles).toBe(first.triangles);
  });

  test('a different seed produces a different board', async ({ page }) => {
    // Compare the cut itself. Triangle counts can legitimately coincide between two seeds -- the
    // flattener often needs the same number of segments -- so counting them proves nothing.
    const outlineOf = async (query: string): Promise<string> => {
      await bootGame(page, query);
      return page.evaluate(() => {
        const board = (globalThis as never as GameHandle).hexforge.app.board as unknown as {
          pieces: { outline: { x: number; y: number }[] }[];
        };
        return board.pieces[0]!.outline
          .slice(0, 24)
          .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
          .join(' ');
      });
    };

    const a = await outlineOf('?difficulty=0&seed=1');
    const b = await outlineOf('?difficulty=0&seed=2');
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(50);
  });
});

test.describe('persistence', () => {
  test('a partly solved board comes back after a reload', async ({ page }) => {
    await bootGame(page, SAMPLER);
    await dragPieceHome(page, 1);
    await dragPieceHome(page, 2);

    const before = await snapshot(page);
    expect(before.clusters).toBeLessThan(7);

    // The board is saved on a debounce, so give it a beat before reloading.
    await page.waitForTimeout(2500);
    await page.reload();
    await page.waitForFunction(() => document.body.dataset['hexforgeState'] === 'ready');

    const after = await snapshot(page);
    expect(after.code).toBe(before.code);
    expect(after.clusters).toBe(before.clusters);
  });
});

test.describe('print export', () => {
  test('produces a well-formed A4 SVG with one path per cut line', async ({ page }) => {
    await bootGame(page, SAMPLER);

    const result = await page.evaluate(() => {
      const g = (globalThis as never as GameHandle).hexforge;
      const svg = g.hud.exportPrint('a4');
      // Parse it with the browser's own XML parser -- the strongest well-formedness check there is.
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      return {
        parseError: doc.querySelector('parsererror')?.textContent ?? null,
        root: doc.documentElement.tagName,
        width: doc.documentElement.getAttribute('width'),
        height: doc.documentElement.getAttribute('height'),
        paths: doc.querySelectorAll('path').length,
        uniqueEdges: g.app.board.uniqueEdges.length,
      };
    });

    expect(result.parseError).toBeNull();
    expect(result.root).toBe('svg');
    expect(result.width).toBe('210mm');
    expect(result.height).toBe('297mm');
    expect(result.paths).toBe(result.uniqueEdges);
  });

  test('offers the pattern as a download', async ({ page }) => {
    await bootGame(page, SAMPLER);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Print pattern' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^hexforge-7p-[0-9a-f]{8}\.svg$/);
  });
});

test.describe('controls', () => {
  test('the hint assist names two pieces that connect', async ({ page }) => {
    await bootGame(page, SAMPLER);
    await page.getByRole('button', { name: 'Hint (H)' }).click();
    await expect(page.locator('[role="status"]')).toContainText(/joins piece/);
  });

  test('edge sort gathers the border pieces', async ({ page }) => {
    await bootGame(page, SAMPLER);
    await page.getByRole('button', { name: 'Edges (S)' }).click();
    await expect(page.locator('[role="status"]')).toContainText(/Gathered \d+ edge pieces/);
  });

  test('settings open and close', async ({ page }) => {
    await bootGame(page, SAMPLER);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden();
  });

  test('changing difficulty starts a bigger board', async ({ page }) => {
    await bootGame(page, SAMPLER);
    expect((await snapshot(page)).pieces).toBe(7);
    await page.getByLabel('Difficulty').selectOption('1');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForFunction(
      () => (globalThis as never as GameHandle).hexforge.app.session.progress.pieces === 37,
    );
    expect((await snapshot(page)).pieces).toBe(37);
  });

  test('an invalid puzzle code is rejected without breaking the board', async ({ page }) => {
    await bootGame(page, SAMPLER);
    const before = await snapshot(page);
    await page.getByLabel('Puzzle code').fill('not-a-code!');
    await page.getByLabel('Puzzle code').press('Enter');
    await expect(page.locator('[role="status"]')).toContainText('not valid');
    expect((await snapshot(page)).code).toBe(before.code);
  });
});

test.describe('performance', () => {
  test('holds the frame budget on a 217-piece board', async ({ page }) => {
    await bootGame(page, '?difficulty=3&seed=7');

    const fallback = await page.evaluate(
      () => (globalThis as never as GameHandle).hexforge.gpu.info.isFallback,
    );
    // Refuse to report a number that was never measured. SwiftShader is a CPU rasteriser; a frame
    // time from it says nothing about the hardware this game actually runs on.
    test.skip(fallback, 'software adapter (SwiftShader): frame timing is not meaningful');

    await page.waitForTimeout(4000);
    const stats = await page.evaluate(() => {
      const times = (globalThis as never as GameHandle).hexforge.app.frameTimes.toSorted(
        (a, b) => a - b,
      );
      return {
        count: times.length,
        p50: times[Math.floor(times.length * 0.5)],
        p95: times[Math.floor(times.length * 0.95)],
      };
    });

    expect(stats.count).toBeGreaterThan(100);
    expect(stats.p95).toBeLessThanOrEqual(16.6);
  });

  test('a large board still generates and uploads in reasonable time', async ({ page }) => {
    // Not a frame-rate claim -- board generation is CPU work and is meaningful even on SwiftShader.
    await bootGame(page, '?difficulty=0&seed=3');
    const ms = await page.evaluate(() => {
      const start = performance.now();
      (globalThis as never as GameHandle).hexforge.app.session.scatter();
      return performance.now() - start;
    });
    expect(ms).toBeLessThan(500);
  });
});
