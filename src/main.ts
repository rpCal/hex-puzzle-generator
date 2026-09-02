import './ui/styles.css';
import { GpuFailure, requestGpu } from '@gfx/device.ts';
import { Renderer } from '@gfx/renderer.ts';
import { HexforgeApp } from '@game/app.ts';
import { Hud, showCapabilityScreen } from './ui/hud.ts';
import {
  clampPuzzleId,
  encodePuzzleId,
  fromUrlHash,
  toUrlHash,
  type PuzzleId,
} from '@core/seed/codec.ts';
import { Difficulty, difficultyInfo, Mode } from '@core/rules/presets.ts';
import { registerServiceWorker } from './pwa/register.ts';

/**
 * Bootstrap.
 *
 * Reads the puzzle out of the URL if there is one — a shared link *is* the puzzle, not a lookup key
 * — starts the GPU, and wires input to the app. Test hooks are exposed on `window.hexforge` so the
 * e2e suite can drive real gameplay without scraping the DOM for internal state.
 */

const params = new URLSearchParams(globalThis.location.search);

function initialPuzzle(): PuzzleId {
  const fromHash = fromUrlHash(globalThis.location.hash);
  if (fromHash !== null) return fromHash;

  // `?difficulty=`, `?rings=`, `?seed=` and `?mode=` let the e2e and media suites ask for a
  // specific board -- real gameplay, small enough that a CPU rasteriser stays honest.
  const askedRings = Number(params.get('rings') ?? '');
  const askedDifficulty = Number(params.get('difficulty') ?? '');
  const seed = Number(params.get('seed') ?? '');

  const difficulty =
    params.has('difficulty') && Number.isFinite(askedDifficulty)
      ? (askedDifficulty as Difficulty)
      : Difficulty.Casual;

  return clampPuzzleId({
    mode:
      params.has('mode') && Number.isFinite(Number(params.get('mode')))
        ? (Number(params.get('mode')) as Mode)
        : Mode.Classic,
    difficulty,
    // Ring count follows the difficulty unless the URL overrides it. Leaving it to the codec's
    // default would silently hand every difficulty the same board size.
    rings: Number.isFinite(askedRings) && askedRings > 0 ? askedRings : difficultyInfo(difficulty).rings,
    seed: params.has('seed') && Number.isFinite(seed) ? seed >>> 0 : (Math.random() * 0xffffffff) >>> 0,
    imageId: Math.floor(Math.random() * 0xffffff),
  });
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('missing #canvas');

  let gpu;
  try {
    gpu = await requestGpu({
      canvas,
      onError: (error) => console.error('[webgpu]', error.message),
      onDeviceLost: (info) => {
        if (info.reason !== 'destroyed') {
          showCapabilityScreen('The graphics device was lost. Reloading usually recovers it.', info.message);
        }
      },
    });
  } catch (error) {
    const failure = error instanceof GpuFailure ? error : null;
    showCapabilityScreen(
      failure?.playerMessage ?? 'The graphics device could not be started.',
      failure?.detail ?? String(error),
    );
    document.body.dataset['hexforgeState'] = 'unsupported';
    return;
  }

  const renderer = await Renderer.create(gpu);
  const app = new HexforgeApp({
    gpu,
    renderer,
    events: {
      onProgress: () => hud.update(),
      onStatus: (message) => hud.setStatus(message),
      onSolved: (_app, stars, isRecord) => {
        hud.update();
        hud.showCompletion(stars, isRecord);
        document.body.dataset['hexforgeSolved'] = 'true';
      },
    },
  });

  const hud = new Hud(app, {
    onNewBoard: (puzzle) => startBoard(puzzle, false),
    onImage: (file) => void loadImage(file),
  });

  renderer.attachReferenceCanvas(hud.referenceCanvas);

  function startBoard(puzzle: PuzzleId, resume: boolean): void {
    delete document.body.dataset['hexforgeSolved'];
    hud.hideCompletion();
    app.start(puzzle, { resume });
    hud.syncPuzzle(puzzle);
    hud.update();
    const url = new URL(globalThis.location.href);
    url.hash = toUrlHash(puzzle).slice(1);
    history.replaceState(null, '', url);
  }

  async function loadImage(file: File): Promise<void> {
    try {
      const bitmap = await createImageBitmap(file);
      renderer.setImage(bitmap);
      bitmap.close();
      hud.setStatus('Using your image. It never leaves this device.');
    } catch {
      hud.setStatus('That file could not be read as an image.');
    }
  }

  // ---- sizing ------------------------------------------------------------------------------

  const applySize = (): void => {
    // Cap the device pixel ratio: on a 3x phone display the cost is nine times the fill for a
    // difference nobody can see on a puzzle piece.
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    app.resize(canvas.clientWidth, canvas.clientHeight, dpr);
  };
  new ResizeObserver(applySize).observe(canvas);
  applySize();

  // ---- input -------------------------------------------------------------------------------

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
    void app.pointerDown(event.pointerId, event.clientX, event.clientY);
  });
  canvas.addEventListener('pointermove', (event) => {
    app.pointerMove(event.pointerId, event.clientX, event.clientY);
  });
  const endPointer = (event: PointerEvent): void => {
    canvas.classList.remove('dragging');
    app.pointerUp(event.pointerId);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      app.wheel(event.clientX, event.clientY, event.deltaY);
    },
    { passive: false },
  );

  globalThis.addEventListener('keydown', (event) => {
    // Leave text fields alone, or typing a puzzle code would nudge pieces around.
    const target = event.target as HTMLElement | null;
    if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (app.handleKey(event.key, { shift: event.shiftKey })) {
      event.preventDefault();
      hud.update();
    }
  });

  globalThis.addEventListener('hashchange', () => {
    const puzzle = fromUrlHash(globalThis.location.hash);
    // Compare the encoded codes, not one field: `startBoard` writes the hash itself, so anything
    // less than a whole-puzzle comparison restarts the board every time it does.
    if (puzzle !== null && encodePuzzleId(puzzle) !== app.puzzleCode) {
      startBoard(puzzle, false);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) app.pause();
    else app.resume();
  });

  // ---- go ----------------------------------------------------------------------------------

  startBoard(initialPuzzle(), true);
  app.resume();

  // The clock and the piece counters do not need a repaint every frame. A quarter-second poll is
  // imperceptible for a timer and keeps the HUD out of the render path entirely.
  const hudTimer = setInterval(() => hud.update(), 250);
  globalThis.addEventListener('pagehide', () => {
    clearInterval(hudTimer);
    app.pause();
  });

  document.body.dataset['hexforgeState'] = 'ready';

  // Offline support is a bonus, never a prerequisite: registered after the game is already running
  // and ignored entirely if it fails.
  void registerServiceWorker(new URL(import.meta.env.BASE_URL, globalThis.location.href).pathname);

  // Test surface. Exposed deliberately: driving real gameplay through the real API is a far better
  // e2e test than synthesising pointer events and hoping they land on the right pixel.
  Reflect.set(globalThis, 'hexforge', {
    app,
    hud,
    renderer,
    gpu,
    startBoard,
    solveInstantly: () => {
      app.session.solveInstantly();
      hud.update();
    },
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  showCapabilityScreen('Something went wrong while starting the game.', String(error));
  document.body.dataset['hexforgeState'] = 'error';
});
