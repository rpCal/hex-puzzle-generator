import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { webgpuChromiumArgs } from '../tools/webgpu-launch.ts';

/**
 * Generate the README's screenshots and GIFs by playing the game.
 *
 * Nothing here is staged: every frame comes from the real build, driven through the real input
 * path, rendered by a real WebGPU device. Regenerating is one command, so the README cannot drift
 * away from what the game actually looks like.
 *
 * This is only possible because WebGPU canvas content is composited into `page.screenshot()` in
 * headless Chromium — verified during research by rendering a known gradient and reading back
 * `pixel(0,0) = rgb(1,38,217)` against an expected `rgb(0,38,217)` (docs/RESEARCH.md §2.3). Had
 * that not held, every image below would come out black.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs/media');
const FRAMES = join(ROOT, '.media-frames');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/hex-puzzle-generator/`;
const VIEWPORT = { width: 1280, height: 800 };

const log = (...args) => process.stdout.write(`${args.join(' ')}\n`);

function ffmpegPath() {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return 'ffmpeg';
  // Playwright ships its own build for video recording; reuse it rather than adding a dependency.
  const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('ffmpeg-')) continue;
      const candidate = join(cache, entry, 'ffmpeg-linux');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Encode a numbered frame sequence to a looping GIF with a per-clip optimised palette. */
function encodeGif(name, fps) {
  const ffmpeg = ffmpegPath();
  if (ffmpeg === null) {
    log(`  ! ffmpeg not found, skipping ${name}.gif`);
    return false;
  }
  // Crop the static HUD bars away, scale to 640, 96 colours, ordered dither.
  //
  // Two things dominate GIF size here. Error-diffusion dithers look marginally better and compress
  // terribly -- they scatter noise that destroys run-length coding. And the HUD is fine detail that
  // never changes, so it costs palette entries and inter-frame deltas for nothing. Together these
  // took each clip from about 5 MB to under 1 MB.
  const filter =
    `crop=${VIEWPORT.width}:${VIEWPORT.height - 190}:0:70,fps=${fps},` +
    `scale=640:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=96:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  const result = spawnSync(
    ffmpeg,
    ['-y', '-framerate', String(fps), '-i', join(FRAMES, `${name}-%04d.png`), '-vf', filter, '-loop', '0', join(OUT, `${name}.gif`)],
    { stdio: 'ignore' },
  );
  if (result.status !== 0) {
    log(`  ! ffmpeg failed for ${name}`);
    return false;
  }
  return true;
}

/** Scale a screenshot down for the README. Full-resolution stills are megabytes each. */
function shrinkPng(path) {
  const ffmpeg = ffmpegPath();
  if (ffmpeg === null) return;
  const temporary = `${path}.tmp.png`;
  const result = spawnSync(
    ffmpeg,
    ['-y', '-i', path, '-vf', 'scale=1024:-1:flags=lanczos', '-compression_level', '100', temporary],
    { stdio: 'ignore' },
  );
  if (result.status === 0 && existsSync(temporary)) renameSync(temporary, path);
  else rmSync(temporary, { force: true });
}

async function main() {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  log('building…');
  if (spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
    throw new Error('build failed');
  }

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {
        // preview server not up yet
      }
      await sleep(500);
    }

    const browser = await chromium.launch({ headless: true, args: webgpuChromiumArgs() });
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => log('  ! page error:', String(error)));

    const boot = async (query) => {
      await page.goto(BASE + query);
      await page.waitForFunction(() => document.body.dataset.hexforgeState === 'ready', null, {
        timeout: 60_000,
      });
      await sleep(1400);
    };

    const shot = async (name) => {
      const path = join(OUT, `${name}.png`);
      await page.screenshot({ path });
      shrinkPng(path);
      log(`  → ${name}.png`);
    };

    /**
     * Capture `count` frames while `step(i)` advances the scene.
     *
     * `settleMs` may be a function of the frame index. That matters for the snap burst: a
     * screenshot under SwiftShader costs a few hundred milliseconds of wall clock, which is most of
     * a spark's half-second life, so the frames right after a release are taken back to back with
     * no added delay or the effect is over before the first one lands.
     */
    const clip = async (name, count, step, settleMs = 90) => {
      const delayFor = typeof settleMs === 'function' ? settleMs : () => settleMs;
      for (let i = 0; i < count; i++) {
        await step(i);
        const delay = delayFor(i);
        if (delay > 0) await sleep(delay);
        await page.screenshot({ path: join(FRAMES, `${name}-${String(i).padStart(4, '0')}.png`) });
      }
      log(`  → ${name}: ${count} frames`);
    };

    // ---- 1. the scattered board -------------------------------------------------------------
    log('scattered board…');
    await boot('?difficulty=1&seed=20260902');
    await shot('board');

    // ---- 2. drag and snap, with the particle burst -------------------------------------------
    log('drag and snap…');
    await boot('?difficulty=0&seed=20260902');
    await page.evaluate(() => {
      const g = globalThis.hexforge;
      g.app.camera.fit(g.app.session.currentBounds?.() ?? g.app.board.bounds, 1.3);
    });
    await sleep(400);

    const positionsFor = async (piece) =>
      page.evaluate((index) => {
        const g = globalThis.hexforge;
        const app = g.app;
        const canvas = app.gpu.canvas;
        const rect = canvas.getBoundingClientRect();
        const toCss = (p) => ({
          x: rect.left + (p.x / canvas.width) * rect.width,
          y: rect.top + (p.y / canvas.height) * rect.height,
        });
        const anchor = app.session.clusters.find(0);
        const anchorWorld = app.session.clusters.worldPosition(anchor);
        const target = {
          x: anchorWorld.x + (app.board.pieces[index].center.x - app.board.pieces[anchor].center.x),
          y: anchorWorld.y + (app.board.pieces[index].center.y - app.board.pieces[anchor].center.y),
        };
        return {
          from: toCss(app.camera.worldToScreen(app.session.clusters.worldPosition(index))),
          to: toCss(app.camera.worldToScreen(target)),
        };
      }, piece);

    {
      const { from, to } = await positionsFor(1);
      const steps = 18;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await clip(
        'snap',
        34,
        async (i) => {
          if (i < steps) {
            const t = (i + 1) / steps;
            // Ease out, so the piece decelerates into place the way a hand would move it.
            const e = 1 - (1 - t) ** 3;
            await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
          } else if (i === steps) {
            await page.mouse.up();
          }
        },
        // No added delay for the frames right after the drop, so the spark burst is actually in
        // shot rather than already expired by the time the first screenshot completes.
        (i) => (i >= steps ? 0 : 70),
      );
      if (encodeGif('snap', 20)) log('  → snap.gif');
    }

    // ---- 3. welding a cluster, then dragging it as one ---------------------------------------
    log('cluster welding…');
    await boot('?difficulty=0&seed=20260902');
    await clip(
      'weld',
      30,
      async (i) => {
        if (i % 4 === 0 && i / 4 < 7) {
          const piece = i / 4;
          const { from, to } = await positionsFor(piece);
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 4 });
          await page.mouse.up();
        }
      },
      110,
    );
    if (encodeGif('weld', 12)) log('  → weld.gif');

    // ---- 4. completion: the cut lines fade and the picture becomes seamless -------------------
    log('completion…');
    await boot('?difficulty=1&seed=20260902');
    await clip(
      'complete',
      30,
      async (i) => {
        if (i === 3) {
          await page.evaluate(() => {
            const g = globalThis.hexforge;
            g.solveInstantly();
            g.app.camera.fit(g.app.board.bounds, 1.5);
          });
        }
      },
      80,
    );
    if (encodeGif('complete', 14)) log('  → complete.gif');
    await shot('solved');

    // ---- 5. stills ---------------------------------------------------------------------------
    log('stills…');
    await boot('?difficulty=2&seed=31415');
    await page.evaluate(() => {
      const g = globalThis.hexforge;
      g.solveInstantly();
      g.app.camera.fit(g.app.board.bounds, 1.35);
    });
    await sleep(1600);
    await shot('assembled-91');

    // A close-up of a board that is *not* finished. Solving fades the cut shading out on purpose,
    // so a solved board is exactly the wrong subject for a picture about how the pieces look.
    await boot('?difficulty=1&seed=31415');
    await page.evaluate(() => {
      const g = globalThis.hexforge;
      const app = g.app;
      // Assemble part of the board so the shot shows both joined and loose pieces.
      for (let piece = 0; piece < 12; piece++) {
        const anchor = app.session.clusters.find(0);
        const anchorWorld = app.session.clusters.worldPosition(anchor);
        app.session.grab(piece);
        app.session.dragTo({
          x: anchorWorld.x + (app.board.pieces[piece].center.x - app.board.pieces[anchor].center.x),
          y: anchorWorld.y + (app.board.pieces[piece].center.y - app.board.pieces[anchor].center.y),
        });
        app.session.release();
      }
      // Frame the assembly where it actually is. It forms around wherever piece 0 was scattered,
      // not at the solved board's centre -- aiming at the latter points the camera at empty table.
      const members = app.session.clusters.membersOf(0);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const member of members) {
        const p = app.session.clusters.worldPosition(member);
        const r = app.board.pieces[member].boundingRadius;
        minX = Math.min(minX, p.x - r);
        minY = Math.min(minY, p.y - r);
        maxX = Math.max(maxX, p.x + r);
        maxY = Math.max(maxY, p.y + r);
      }
      app.camera.fit({ min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }, 1.25);
    });
    await sleep(1400);
    await shot('closeup');

    // The print pattern itself, rasterised from the real SVG export. Showing the thing this
    // project grew out of matters more than describing it.
    log('print pattern…');
    await boot('?difficulty=1&seed=20260902');
    const svg = await page.evaluate(() => globalThis.hexforge.hud.exportPrint('a4'));
    const svgPath = join(FRAMES, 'pattern.svg');
    writeFileSync(svgPath, svg);
    if (spawnSync('convert', ['-version'], { stdio: 'ignore' }).status === 0) {
      const status = spawnSync(
        'convert',
        ['-density', '110', '-background', 'white', '-alpha', 'remove', svgPath, join(OUT, 'print-pattern.png')],
        { stdio: 'ignore' },
      ).status;
      if (status === 0) {
        shrinkPng(join(OUT, 'print-pattern.png'));
        log('  → print-pattern.png');
      } else {
        log('  ! rasterising the pattern failed');
      }
    } else {
      log('  ! ImageMagick not found, skipping print-pattern.png');
    }

    // The capability screen, so the README can show what a browser without WebGPU gets.
    log('capability screen…');
    const bare = await browser.newPage({ viewport: VIEWPORT });
    await bare.addInitScript(() => {
      Reflect.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    });
    await bare.goto(BASE);
    await bare.waitForFunction(() => document.body.dataset.hexforgeState !== undefined);
    await bare.screenshot({ path: join(OUT, 'capability.png') });
    log('  → capability.png');
    await bare.close();

    await browser.close();
  } finally {
    preview.kill('SIGTERM');
    rmSync(FRAMES, { recursive: true, force: true });
  }

  log('\ndone. media in docs/media/');
}

await main();
