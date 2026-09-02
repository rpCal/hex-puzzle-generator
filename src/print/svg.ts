import type { CutBoard, UniqueEdge } from '@core/cut/board.ts';
import type { Cubic } from '@core/math/bezier.ts';

/**
 * The cut pattern, as a print-ready SVG.
 *
 * This is the feature the whole project grew out of. The 2018 original was a print jig: a commented
 * line in its HTML reads *"Wymiary pliku w pikselach do druku w jakości 72 DPI: 842 x 1 191 px"* —
 * A4 at 72 DPI — and its print stylesheet hid the file picker. You loaded a photo, it stroked a hex
 * lattice over it, and you printed and cut it into a real puzzle.
 *
 * That still works, and it is better than it was:
 *
 *  - true Bezier curves, not the flattened polyline the GPU rasterises
 *  - real physical units, so an A4 print is actually A4
 *  - each shared cut line stroked exactly **once**, which was the original's entire reason for
 *    existing — except now it is guaranteed by the edge-ownership model rather than by a
 *    hand-tuned loop with a special case for the last row
 *
 * And because the cut is a pure function of its seed, the puzzle you print and the puzzle you play
 * for a given seed are the same puzzle.
 */

export interface PageSize {
  readonly name: string;
  /** Millimetres. */
  readonly width: number;
  readonly height: number;
}

export const PAGES = {
  a4: { name: 'A4', width: 210, height: 297 },
  a3: { name: 'A3', width: 297, height: 420 },
  letter: { name: 'Letter', width: 215.9, height: 279.4 },
} as const satisfies Record<string, PageSize>;

export type PageKey = keyof typeof PAGES;

export interface PrintOptions {
  readonly page?: PageSize;
  /** Margin in millimetres. */
  readonly margin?: number;
  /** Stroke width in millimetres. 0.2 is about the finest a home printer resolves reliably. */
  readonly strokeWidth?: number;
  readonly strokeColor?: string;
  /** Optional source image, embedded as a data URI beneath the cut lines. */
  readonly imageDataUri?: string;
  /** Corner crop marks, for trimming after printing. */
  readonly registrationMarks?: boolean;
  /** A caption naming the seed and piece count, so a printed sheet stays identifiable. */
  readonly legend?: string;
  /** Rotate the pattern 90 degrees when the board is wider than it is tall. */
  readonly autoLandscape?: boolean;
}

const escapeXml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Four significant decimals is well below what any printer resolves, and keeps the file small. */
const fmt = (value: number): string => {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

interface Mapping {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly swap: boolean;
}

function project(x: number, y: number, m: Mapping): { x: number; y: number } {
  const px = m.swap ? y : x;
  const py = m.swap ? -x : y;
  return { x: px * m.scale + m.offsetX, y: py * m.scale + m.offsetY };
}

function edgePath(edge: UniqueEdge, m: Mapping): string {
  const first = edge.curves[0];
  if (first === undefined) return '';
  const start = project(first.p0.x, first.p0.y, m);
  let d = `M ${fmt(start.x)} ${fmt(start.y)}`;
  for (const curve of edge.curves as readonly Cubic[]) {
    const c1 = project(curve.p1.x, curve.p1.y, m);
    const c2 = project(curve.p2.x, curve.p2.y, m);
    const to = project(curve.p3.x, curve.p3.y, m);
    d += ` C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(to.x)} ${fmt(to.y)}`;
  }
  return d;
}

export interface PrintResult {
  readonly svg: string;
  readonly page: PageSize;
  /** One path per physical cut line. */
  readonly pathCount: number;
  /** Millimetres per board unit. */
  readonly scale: number;
  readonly landscape: boolean;
}

export function boardToSvg(board: CutBoard, options: PrintOptions = {}): PrintResult {
  const page = options.page ?? PAGES.a4;
  const margin = options.margin ?? 10;
  const strokeWidth = options.strokeWidth ?? 0.2;
  const strokeColor = options.strokeColor ?? '#222222';

  const boardWidth = board.bounds.max.x - board.bounds.min.x;
  const boardHeight = board.bounds.max.y - board.bounds.min.y;

  // Rotating the pattern rather than the page keeps the output a standard sheet size, which is what
  // a printer driver and a paper trimmer both want.
  const swap = (options.autoLandscape ?? true) && boardWidth > boardHeight;
  const contentWidth = swap ? boardHeight : boardWidth;
  const contentHeight = swap ? boardWidth : boardHeight;

  const usableWidth = Math.max(1, page.width - margin * 2);
  const usableHeight = Math.max(1, page.height - margin * 2);
  const scale = Math.min(usableWidth / Math.max(contentWidth, 1e-6), usableHeight / Math.max(contentHeight, 1e-6));

  const drawnWidth = contentWidth * scale;
  const drawnHeight = contentHeight * scale;

  // Centre on the page, then shift so the board's own origin lands correctly.
  const originX = (page.width - drawnWidth) / 2;
  const originY = (page.height - drawnHeight) / 2;
  const mapping: Mapping = {
    scale,
    offsetX: originX - (swap ? board.bounds.min.y : board.bounds.min.x) * scale,
    offsetY: originY - (swap ? -board.bounds.max.x : board.bounds.min.y) * scale,
    swap,
  };

  const paths: string[] = [];
  for (const edge of board.uniqueEdges) {
    const d = edgePath(edge, mapping);
    if (d !== '') paths.push(`    <path d="${d}"/>`);
  }

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
      `width="${fmt(page.width)}mm" height="${fmt(page.height)}mm" ` +
      `viewBox="0 0 ${fmt(page.width)} ${fmt(page.height)}">`,
  );
  parts.push(`  <title>HEXFORGE cut pattern</title>`);
  parts.push(`  <rect width="${fmt(page.width)}" height="${fmt(page.height)}" fill="#ffffff"/>`);

  if (options.imageDataUri !== undefined) {
    parts.push(
      `  <image x="${fmt(originX)}" y="${fmt(originY)}" ` +
        `width="${fmt(drawnWidth)}" height="${fmt(drawnHeight)}" ` +
        `preserveAspectRatio="none" href="${escapeXml(options.imageDataUri)}"/>`,
    );
  }

  parts.push(
    `  <g fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${fmt(strokeWidth)}" ` +
      `stroke-linecap="round" stroke-linejoin="round">`,
  );
  parts.push(...paths);
  parts.push('  </g>');

  if (options.registrationMarks ?? true) {
    const size = 5;
    const inset = Math.max(2, margin / 2);
    const corners: [number, number, number, number][] = [
      [inset, inset, inset + size, inset],
      [inset, inset, inset, inset + size],
      [page.width - inset - size, inset, page.width - inset, inset],
      [page.width - inset, inset, page.width - inset, inset + size],
      [inset, page.height - inset, inset + size, page.height - inset],
      [inset, page.height - inset - size, inset, page.height - inset],
      [page.width - inset - size, page.height - inset, page.width - inset, page.height - inset],
      [page.width - inset, page.height - inset - size, page.width - inset, page.height - inset],
    ];
    parts.push('  <g stroke="#000000" stroke-width="0.15">');
    for (const [x1, y1, x2, y2] of corners) {
      parts.push(
        `    <line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"/>`,
      );
    }
    parts.push('  </g>');
  }

  if (options.legend !== undefined && options.legend !== '') {
    parts.push(
      `  <text x="${fmt(page.width / 2)}" y="${fmt(page.height - Math.max(3, margin / 2))}" ` +
        `font-family="monospace" font-size="3" fill="#666666" text-anchor="middle">` +
        `${escapeXml(options.legend)}</text>`,
    );
  }

  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    page,
    pathCount: paths.length,
    scale,
    landscape: swap,
  };
}

/** A filename that carries the seed, so a printed sheet can be reproduced on screen later. */
export function printFilename(seed: number, pieces: number): string {
  return `hexforge-${pieces}p-${(seed >>> 0).toString(16).padStart(8, '0')}.svg`;
}
