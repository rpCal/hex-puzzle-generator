import { formatDuration, parFor, scoreRun } from '@core/score/par.ts';
import { DIFFICULTIES, MODES, type Difficulty, type Mode } from '@core/rules/presets.ts';
import { clampPuzzleId, encodePuzzleId, fromUrlHash, toUrlHash, type PuzzleId } from '@core/seed/codec.ts';
import { boardToSvg, printFilename, PAGES, type PageKey } from '../print/svg.ts';
import type { HexforgeApp } from '@game/app.ts';
import { Persistence } from '@game/storage.ts';

/**
 * The HUD.
 *
 * Plain DOM and a handful of event listeners — about a dozen controls in total. A framework here
 * would be more configuration than code, and would cost more bytes than the entire game.
 *
 * Every control has a keyboard equivalent and an accessible name, and state changes are announced
 * through a live region, because completing a board without a pointer is a tested requirement.
 */

type El = HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; html?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key.startsWith('aria') || key === 'role') el.setAttribute(toAttr(key), String(value));
    else Reflect.set(el, key, value);
  }
  for (const child of children) el.append(child as Node | string);
  return el;
}

const toAttr = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export interface HudCallbacks {
  onNewBoard(puzzle: PuzzleId): void;
  onImage(file: File): void;
}

export class Hud {
  readonly root: El;
  readonly #app: HexforgeApp;
  readonly #callbacks: HudCallbacks;

  #timer!: HTMLElement;
  #pieces!: HTMLElement;
  #clusters!: HTMLElement;
  #bar!: HTMLElement;
  #status!: HTMLElement;
  #live!: HTMLElement;
  #modeSelect!: HTMLSelectElement;
  #difficultySelect!: HTMLSelectElement;
  #seedInput!: HTMLInputElement;
  #reference!: HTMLElement;
  #completion!: HTMLElement;
  #settings!: HTMLElement;
  #statusTimer = 0;

  constructor(app: HexforgeApp, callbacks: HudCallbacks) {
    this.#app = app;
    this.#callbacks = callbacks;
    this.root = h('div', { id: 'hud' });
    this.root.append(this.#buildTopBar(), h('div'), this.#buildToolbar());
    document.body.append(this.root, this.#buildStatus(), this.#buildCompletion(), this.#buildSettings());
    this.#reference = this.#buildReference();
    document.body.append(this.#reference);
  }

  // -------------------------------------------------------------------------------------------

  #buildTopBar(): El {
    this.#timer = h('b', { textContent: '0:00' });
    this.#pieces = h('b', { textContent: '0' });
    this.#clusters = h('b', { textContent: '0' });
    this.#bar = h('i');

    return h('div', { class: 'panel topbar' }, [
      h('div', { class: 'brand', textContent: 'Hexforge' }),
      h('div', { class: 'stat' }, [this.#timer, h('span', { textContent: 'Time' })]),
      h('div', { class: 'stat' }, [this.#pieces, h('span', { textContent: 'Pieces' })]),
      h('div', { class: 'stat' }, [this.#clusters, h('span', { textContent: 'Groups' })]),
      h('div', {
        class: 'progress',
        role: 'progressbar',
        ariaLabel: 'Puzzle progress',
      }, [this.#bar]),
      h('div', { class: 'spacer' }),
      h('button', {
        textContent: 'Settings',
        ariaLabel: 'Open settings',
        onclick: () => this.#toggle(this.#settings, true),
      }),
    ]);
  }

  #buildToolbar(): El {
    this.#modeSelect = h('select', { ariaLabel: 'Mode' }) as HTMLSelectElement;
    for (const mode of MODES) {
      this.#modeSelect.append(h('option', { value: String(mode.id), textContent: mode.name }));
    }

    this.#difficultySelect = h('select', { ariaLabel: 'Difficulty' }) as HTMLSelectElement;
    for (const difficulty of DIFFICULTIES) {
      this.#difficultySelect.append(
        h('option', {
          value: String(difficulty.id),
          textContent: `${difficulty.name} — ${difficulty.pieces}`,
        }),
      );
    }

    this.#seedInput = h('input', {
      type: 'text',
      ariaLabel: 'Puzzle code',
      spellcheck: false,
      autocomplete: 'off',
    }) as HTMLInputElement;
    this.#seedInput.addEventListener('change', () => this.#applyCode());

    const fileInput = h('input', {
      type: 'file',
      accept: 'image/*',
      class: 'sr-only',
      id: 'image-input',
    }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file !== undefined) this.#callbacks.onImage(file);
    });

    return h('div', { class: 'panel toolbar' }, [
      h('label', { class: 'field' }, ['Mode', this.#modeSelect]),
      h('label', { class: 'field' }, ['Pieces', this.#difficultySelect]),
      h('button', {
        class: 'primary',
        textContent: 'New board',
        onclick: () => this.#newBoard(),
      }),
      h('label', { class: 'field' }, ['Code', this.#seedInput]),
      h('button', { textContent: 'Copy link', onclick: () => void this.#share() }),
      h('div', { class: 'spacer' }),
      h('button', { textContent: 'Hint (H)', onclick: () => this.#app.hint() }),
      h('button', { textContent: 'Edges (S)', onclick: () => this.#app.edgeSort() }),
      h('button', { textContent: 'Scatter (G)', onclick: () => this.#app.session.scatter() }),
      h('button', {
        textContent: 'Fit (F)',
        onclick: () => this.#app.camera.fit(this.#app.board.bounds, 1.15),
      }),
      h('button', { textContent: 'Print pattern', onclick: () => this.exportPrint() }),
      h('button', {
        textContent: 'Own image',
        onclick: () => fileInput.click(),
      }),
      fileInput,
    ]);
  }

  #buildStatus(): El {
    this.#status = h('div', { class: 'status' });
    this.#live = h('div', {
      class: 'sr-only',
      role: 'status',
      ariaLive: 'polite',
      ariaAtomic: 'true',
    });
    const wrap = h('div');
    wrap.append(this.#status, this.#live);
    return wrap;
  }

  #buildReference(): El {
    const box = h('div', { class: 'reference' });
    const canvas = h('canvas', { width: 256, height: 256 }) as HTMLCanvasElement;
    canvas.setAttribute('aria-label', 'Reference image');
    box.append(canvas);
    this.referenceCanvas = canvas;
    box.hidden = true;
    return box;
  }

  /** The thumbnail's canvas, handed to the renderer as a second WebGPU surface. */
  referenceCanvas!: HTMLCanvasElement;

  #buildCompletion(): El {
    this.#completion = h('div', { class: 'scrim' });
    this.#completion.hidden = true;
    return this.#completion;
  }

  #buildSettings(): El {
    const prefs = this.#app.prefs;

    const volume = h('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(prefs.volume),
      ariaLabel: 'Volume',
    }) as HTMLInputElement;
    volume.addEventListener('input', () => this.#app.setPrefs({ volume: Number(volume.value) }));

    const toggle = (
      label: string,
      key: 'reducedMotion' | 'colorblind' | 'highContrastCuts' | 'showReference',
    ): El => {
      const input = h('input', { type: 'checkbox', ariaLabel: label }) as HTMLInputElement;
      input.checked = prefs[key];
      input.addEventListener('change', () => {
        this.#app.setPrefs({ [key]: input.checked });
        document.body.classList.toggle('high-contrast', this.#app.prefs.highContrastCuts);
        this.#reference.hidden = !this.#app.prefs.showReference;
      });
      return h('div', { class: 'row' }, [h('span', { textContent: label }), input]);
    };

    const dialog = h('div', { class: 'dialog' }, [
      h('h2', { textContent: 'Settings' }),
      h('div', { class: 'row' }, [h('span', { textContent: 'Volume' }), volume]),
      toggle('Reduced motion', 'reducedMotion'),
      toggle('Colourblind-safe highlights', 'colorblind'),
      toggle('High contrast cut lines', 'highContrastCuts'),
      toggle('Show reference image', 'showReference'),
      h('p', {
        html:
          'Keyboard: <b>Tab</b> cycle pieces, <b>arrows</b> nudge (hold <b>Shift</b> for bigger steps), ' +
          '<b>Enter</b> place, <b>Q</b>/<b>E</b> rotate, <b>F</b> fit, <b>S</b> sort edges, ' +
          '<b>G</b> re-scatter, <b>H</b> hint.',
      }),
      h('button', {
        class: 'primary',
        textContent: 'Close',
        onclick: () => this.#toggle(this.#settings, false),
      }),
    ]);

    this.#settings = h('div', { class: 'scrim' }, [dialog]);
    this.#settings.hidden = true;
    this.#settings.addEventListener('click', (event) => {
      if (event.target === this.#settings) this.#toggle(this.#settings, false);
    });
    return this.#settings;
  }

  // -------------------------------------------------------------------------------------------

  #toggle(el: El, open: boolean): void {
    el.hidden = !open;
  }

  #currentSelection(): PuzzleId {
    const mode = Number(this.#modeSelect.value) as Mode;
    const difficulty = Number(this.#difficultySelect.value) as Difficulty;
    return clampPuzzleId({
      mode,
      difficulty,
      rings: DIFFICULTIES[difficulty]?.rings ?? 5,
      seed: (Math.random() * 0xffffffff) >>> 0,
      imageId: Math.floor(Math.random() * 0xffffff),
    });
  }

  #newBoard(): void {
    this.#callbacks.onNewBoard(this.#currentSelection());
  }

  #applyCode(): void {
    const parsed = fromUrlHash(this.#seedInput.value.trim());
    if (parsed === null) {
      this.setStatus('That puzzle code is not valid.');
      this.syncPuzzle(this.#app.puzzle);
      return;
    }
    this.#callbacks.onNewBoard(parsed);
  }

  async #share(): Promise<void> {
    const url = new URL(globalThis.location.href);
    url.hash = toUrlHash(this.#app.puzzle).slice(1);
    const link = url.toString();
    try {
      await navigator.clipboard.writeText(link);
      this.setStatus('Link copied. Same seed, same puzzle, for anyone who opens it.');
    } catch {
      // Clipboard access can be denied; showing the link is still useful.
      this.setStatus(link);
    }
  }

  /** Export the cut pattern as a print-ready SVG and hand it to the browser as a download. */
  exportPrint(page: PageKey = 'a4'): string {
    const board = this.#app.board;
    const result = boardToSvg(board, {
      page: PAGES[page],
      legend: `hexforge · ${board.pieces.length} pieces · ${this.#app.puzzleCode}`,
    });
    const blob = new Blob([result.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = h('a', {
      href: url,
      download: printFilename(this.#app.puzzle.seed, board.pieces.length),
    });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.setStatus(`Exported ${result.pathCount} cut lines at ${result.page.name}. Print and cut.`);
    return result.svg;
  }

  // -------------------------------------------------------------------------------------------

  syncPuzzle(puzzle: PuzzleId): void {
    this.#modeSelect.value = String(puzzle.mode);
    this.#difficultySelect.value = String(puzzle.difficulty);
    this.#seedInput.value = encodePuzzleId(puzzle);
    this.#reference.hidden = !this.#app.prefs.showReference || MODES[puzzle.mode]?.hidesReference === true;
  }

  update(): void {
    const app = this.#app;
    if (app.session === undefined) return;
    const progress = app.session.progress;
    this.#timer.textContent = formatDuration(app.session.elapsedSeconds);
    this.#pieces.textContent = String(progress.pieces);
    this.#clusters.textContent = String(progress.clusters);
    this.#bar.style.width = `${(progress.fraction * 100).toFixed(1)}%`;
    this.#bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(progress.fraction * 100)));
  }

  setStatus(message: string): void {
    this.#status.textContent = message;
    this.#status.classList.add('show');
    this.#live.textContent = message;
    if (this.#statusTimer !== 0) clearTimeout(this.#statusTimer);
    this.#statusTimer = setTimeout(() => this.#status.classList.remove('show'), 4200) as unknown as number;
  }

  showCompletion(stars: number, isRecord: boolean): void {
    const app = this.#app;
    const score = scoreRun(app.session.elapsedSeconds, app.board.pieces.length, app.parKey);
    const best = app.persistence.bestFor(
      Persistence.runKey(app.puzzleCode, app.puzzle.mode, app.puzzle.difficulty),
    );

    const dialog = h('div', { class: 'dialog', role: 'dialog', ariaModal: 'true' }, [
      h('h2', { textContent: 'Solved' }),
      h('div', {
        class: 'stars',
        textContent: '★'.repeat(stars) + '☆'.repeat(3 - stars),
        ariaLabel: `${stars} of 3 stars`,
      }),
      h('div', { class: 'row' }, [
        h('span', { textContent: 'Your time' }),
        h('b', { textContent: formatDuration(score.elapsedSeconds) }),
      ]),
      h('div', { class: 'row' }, [
        h('span', { textContent: 'Par' }),
        h('b', { textContent: formatDuration(parFor(app.board.pieces.length, app.parKey)) }),
      ]),
      h('div', { class: 'row' }, [
        h('span', { textContent: 'Best' }),
        h('b', { textContent: best === null ? '—' : formatDuration(best.bestSeconds) }),
      ]),
      isRecord ? h('p', { class: 'record', textContent: 'New personal best.' }) : h('span'),
      h('p', { textContent: `Puzzle code ${app.puzzleCode} — anyone who opens it gets this exact cut.` }),
      h('div', { class: 'row' }, [
        h('button', { textContent: 'Copy link', onclick: () => void this.#share() }),
        h('button', { textContent: 'Print pattern', onclick: () => this.exportPrint() }),
        h('button', {
          class: 'primary',
          textContent: 'New board',
          onclick: () => {
            this.#toggle(this.#completion, false);
            this.#newBoard();
          },
        }),
      ]),
    ]);

    this.#completion.replaceChildren(dialog);
    this.#toggle(this.#completion, true);
    (dialog.querySelector('button.primary') as HTMLButtonElement | null)?.focus();
    this.#live.textContent = `Solved in ${formatDuration(score.elapsedSeconds)}. ${stars} of 3 stars.`;
  }

  hideCompletion(): void {
    this.#toggle(this.#completion, false);
  }

  /** Attach a small copy of the source image, so players can check what they are building. */
  setReference(node: HTMLCanvasElement | HTMLImageElement): void {
    this.#reference.replaceChildren(node);
  }
}

/**
 * The capability screen, shown when WebGPU is unavailable.
 *
 * Not an error page. It names the browsers that do support it and what to do, because the honest
 * answer to "your browser cannot run this" is "here is one that can".
 */
export function showCapabilityScreen(message: string, detail: string): void {
  const screen = h('div', { class: 'capability' }, [
    h('div', { class: 'dialog' }, [
      h('h2', { textContent: 'Hexforge needs WebGPU' }),
      h('p', { textContent: message }),
      h('p', {
        html:
          'WebGPU has shipped in <b>Chrome and Edge 113+</b>, <b>Firefox 141+</b> on Windows and ' +
          '<b>145+</b> on Apple Silicon, and <b>Safari 26</b> on macOS Tahoe, iOS and iPadOS. ' +
          'Updating your browser is usually enough.',
      }),
      h('p', {
        html: `Diagnostic: <code>${detail.replaceAll('<', '&lt;')}</code>`,
      }),
    ]),
  ]);
  document.body.append(screen);
}
