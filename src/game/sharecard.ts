import { formatDuration } from '@core/score/par.ts';

/**
 * The completion share card.
 *
 * Composited on a 2D canvas from the live board — the game canvas is drawn straight into it, so the
 * card shows the actual solved picture rather than a mock-up — with the time, rating and puzzle code
 * burned in. The code is the point: whoever sees the card can play the identical board.
 *
 * Everything here is best-effort. Sharing may be unavailable, the clipboard may be denied, and a
 * WebGPU canvas is not guaranteed to be readable by `drawImage` on every platform. None of those is
 * worth an exception at the moment a player has just finished a puzzle.
 */

export interface ShareCardOptions {
  readonly source: HTMLCanvasElement;
  readonly seconds: number;
  readonly stars: number;
  readonly pieces: number;
  readonly code: string;
  readonly width?: number;
  readonly height?: number;
}

const BACKGROUND = '#12151f';
const ACCENT = '#58a6ff';
const MUTED = '#9aa4bb';
const STAR = '#f0c469';

export function drawShareCard(options: ShareCardOptions): HTMLCanvasElement {
  const width = options.width ?? 1200;
  const height = options.height ?? 630;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  // Cover-fit the board image into the left two thirds, cropping rather than distorting.
  const panel = Math.round(width * 0.62);
  try {
    const source = options.source;
    const scale = Math.max(panel / source.width, height / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, panel, height);
    ctx.clip();
    ctx.drawImage(source, (panel - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    ctx.restore();
  } catch {
    // Some platforms refuse to read back a WebGPU canvas. The card is still worth producing.
    ctx.fillStyle = '#1b2030';
    ctx.fillRect(0, 0, panel, height);
  }

  // Fade the board into the panel so the text side has somewhere quiet to sit.
  const fade = ctx.createLinearGradient(panel - 180, 0, panel, 0);
  fade.addColorStop(0, 'rgba(18, 21, 31, 0)');
  fade.addColorStop(1, BACKGROUND);
  ctx.fillStyle = fade;
  ctx.fillRect(panel - 180, 0, 180, height);

  const x = panel + 48;
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = ACCENT;
  ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('HEXFORGE', x, 118);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#f2f4f9';
  ctx.font = '700 92px ui-monospace, monospace';
  ctx.fillText(formatDuration(options.seconds), x, 232);

  ctx.fillStyle = STAR;
  ctx.font = '48px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('★'.repeat(options.stars) + '☆'.repeat(Math.max(0, 3 - options.stars)), x, 306);

  ctx.fillStyle = MUTED;
  ctx.font = '26px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(`${options.pieces} pieces solved`, x, 372);

  ctx.fillStyle = MUTED;
  ctx.font = '20px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Same board, same cut, for anyone:', x, 470);

  ctx.fillStyle = '#f2f4f9';
  ctx.font = '600 40px ui-monospace, monospace';
  ctx.fillText(options.code, x, 522);

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  return canvas;
}

export interface ShareResult {
  readonly method: 'share' | 'clipboard' | 'download' | 'none';
}

/**
 * Offer the card, preferring the platform's own share sheet.
 *
 * Falls back through the clipboard to a download, because "nothing happened" is the worst possible
 * outcome for a button a player pressed on purpose.
 */
export async function shareCard(canvas: HTMLCanvasElement, filename: string): Promise<ShareResult> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (blob === null) return { method: 'none' };

  const file = new File([blob], filename, { type: 'image/png' });

  try {
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Hexforge' });
      return { method: 'share' };
    }
  } catch {
    // A cancelled share sheet throws; fall through rather than treating it as a failure.
  }

  try {
    if (typeof ClipboardItem === 'function' && navigator.clipboard?.write !== undefined) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { method: 'clipboard' };
    }
  } catch {
    // Clipboard image writes are frequently denied. Downloading always works.
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { method: 'download' };
}
