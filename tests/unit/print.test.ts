import { describe, it, expect } from 'vitest';
import { boardToSvg, printFilename, PAGES } from '../../src/print/svg.ts';
import { generateCut, type CutBoard } from '@core/cut/board.ts';

const board: CutBoard = generateCut({
  seed: 424242,
  shape: { kind: 'hex', rings: 2 },
  radius: 52,
  tab: { tabSize: 0.16, jitter: 0.06 },
});

/** Pull every `d` attribute out, so the paths can be inspected without a DOM. */
function paths(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1] as string);
}

function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe('page geometry', () => {
  it('emits a document at true physical A4 dimensions', () => {
    const { svg, page } = boardToSvg(board);
    expect(page).toEqual(PAGES.a4);
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain('viewBox="0 0 210 297"');
  });

  it('supports the other page sizes', () => {
    expect(boardToSvg(board, { page: PAGES.a3 }).svg).toContain('width="297mm"');
    expect(boardToSvg(board, { page: PAGES.letter }).svg).toContain('height="279.4mm"');
  });

  it('is well-formed XML with a single root svg element', () => {
    const { svg } = boardToSvg(board);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg\b/g)).toHaveLength(1);
    expect(svg.match(/<\/svg>/g)).toHaveLength(1);
  });

  it('balances every element it opens', () => {
    // Real XML well-formedness is asserted against a browser's own parser in the e2e print test;
    // this is the cheap structural guard that runs on every commit.
    const { svg } = boardToSvg(board, { legend: 'x', imageDataUri: 'data:,' });
    for (const tag of ['g', 'text']) {
      const open = svg.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? [];
      const close = svg.match(new RegExp(`</${tag}>`, 'g')) ?? [];
      expect(close).toHaveLength(open.length);
    }
    // Void elements must be self-closed.
    for (const tag of ['path', 'line', 'rect', 'image']) {
      expect(svg).not.toContain(`</${tag}>`);
    }
  });
});

describe('cut lines', () => {
  /**
   * The original's whole reason for existing: an interior edge shared by two hexes must be stroked
   * once, not twice, or it prints at double ink density. Here it falls straight out of the
   * edge-ownership model rather than needing a special-cased drawing loop.
   */
  it('emits exactly one path per physical cut line', () => {
    const result = boardToSvg(board);
    expect(result.pathCount).toBe(board.uniqueEdges.length);
    expect(paths(result.svg)).toHaveLength(board.uniqueEdges.length);
  });

  it('emits fewer paths than six per piece, because interior edges are shared', () => {
    const result = boardToSvg(board);
    expect(result.pathCount).toBeLessThan(board.pieces.length * 6);
  });

  it('uses true cubic Beziers, not the flattened polyline', () => {
    // A polyline would be all L commands and far more of them.
    const all = paths(boardToSvg(board).svg);
    for (const d of all) {
      expect(d.startsWith('M ')).toBe(true);
      expect(d).toContain(' C ');
      expect(d).not.toContain(' L ');
    }
    // A tabbed edge is three cubics; a border edge is one.
    const curveCounts = all.map((d) => (d.match(/ C /g) ?? []).length);
    expect(new Set(curveCounts)).toEqual(new Set([1, 3]));
  });

  it('keeps every drawn point inside the page', () => {
    const { svg, page } = boardToSvg(board, { margin: 10 });
    for (const d of paths(svg)) {
      const values = numbersIn(d);
      for (let i = 0; i < values.length; i += 2) {
        expect(values[i]).toBeGreaterThanOrEqual(-0.01);
        expect(values[i]).toBeLessThanOrEqual(page.width + 0.01);
        expect(values[i + 1]).toBeGreaterThanOrEqual(-0.01);
        expect(values[i + 1]).toBeLessThanOrEqual(page.height + 0.01);
      }
    }
  });

  it('respects the margin', () => {
    const margin = 30;
    const { svg, page } = boardToSvg(board, { margin, registrationMarks: false });
    let minX = Infinity;
    let maxX = -Infinity;
    for (const d of paths(svg)) {
      const values = numbersIn(d);
      for (let i = 0; i < values.length; i += 2) {
        minX = Math.min(minX, values[i] as number);
        maxX = Math.max(maxX, values[i] as number);
      }
    }
    // Tabs stick out past the nominal board bounds, so allow a little slack.
    expect(minX).toBeGreaterThan(margin - 6);
    expect(maxX).toBeLessThan(page.width - margin + 6);
  });

  it('strokes in millimetres, single-stroked', () => {
    const { svg } = boardToSvg(board, { strokeWidth: 0.3 });
    expect(svg).toContain('stroke-width="0.3"');
    expect(svg).toContain('fill="none"');
  });
});

describe('scale', () => {
  it('fills the page: the pattern is as large as the margins allow', () => {
    const result = boardToSvg(board, { margin: 10, registrationMarks: false });
    const boardWidth = board.bounds.max.x - board.bounds.min.x;
    const boardHeight = board.bounds.max.y - board.bounds.min.y;
    const drawn = Math.max(boardWidth, boardHeight) * result.scale;
    // One dimension must reach the usable extent; the other is whatever the aspect ratio gives.
    const usable = Math.max(PAGES.a4.width - 20, PAGES.a4.height - 20);
    expect(drawn).toBeGreaterThan(usable * 0.6);
  });

  it('rotates a wide board onto a portrait page instead of shrinking it', () => {
    const wide = generateCut({
      seed: 1,
      shape: { kind: 'rect', cols: 10, rows: 3 },
      radius: 52,
      tab: { tabSize: 0.16, jitter: 0.06 },
    });
    const rotated = boardToSvg(wide);
    const notRotated = boardToSvg(wide, { autoLandscape: false });
    expect(rotated.landscape).toBe(true);
    expect(notRotated.landscape).toBe(false);
    expect(rotated.scale).toBeGreaterThan(notRotated.scale);
  });

  it('leaves a tall board unrotated', () => {
    const tall = generateCut({
      seed: 1,
      shape: { kind: 'rect', cols: 3, rows: 12 },
      radius: 52,
      tab: { tabSize: 0.16, jitter: 0.06 },
    });
    expect(boardToSvg(tall).landscape).toBe(false);
  });
});

describe('optional furniture', () => {
  it('embeds an image when given one, beneath the cut lines', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    const { svg } = boardToSvg(board, { imageDataUri: uri });
    expect(svg).toContain(`href="${uri}"`);
    expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('<path'));
  });

  it('omits the image element when none is supplied', () => {
    expect(boardToSvg(board).svg).not.toContain('<image');
  });

  it('draws registration marks by default and can be told not to', () => {
    expect(boardToSvg(board).svg).toContain('<line');
    expect(boardToSvg(board, { registrationMarks: false }).svg).not.toContain('<line');
  });

  it('adds a legend when asked', () => {
    const { svg } = boardToSvg(board, { legend: 'seed 424242 / 19 pieces' });
    expect(svg).toContain('seed 424242 / 19 pieces');
  });

  it('escapes XML metacharacters in the legend', () => {
    const { svg } = boardToSvg(board, { legend: 'a & b <c> "d"' });
    expect(svg).toContain('a &amp; b &lt;c&gt; &quot;d&quot;');
    // The raw characters must not survive anywhere in the document.
    expect(svg).not.toContain('a & b <c>');
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    expect(boardToSvg(board).svg).toBe(boardToSvg(board).svg);
  });

  it('produces the same cut as the on-screen board for a given seed', () => {
    // The printed puzzle and the played puzzle are the same puzzle. That is the point.
    const again = generateCut(board.options);
    expect(boardToSvg(again).svg).toBe(boardToSvg(board).svg);
  });

  it('changes with the seed', () => {
    const other = generateCut({ ...board.options, seed: board.options.seed + 1 });
    expect(boardToSvg(other).svg).not.toBe(boardToSvg(board).svg);
  });
});

describe('printFilename', () => {
  it('carries the seed in hex so a sheet can be reproduced later', () => {
    expect(printFilename(0xdeadbeef, 91)).toBe('hexforge-91p-deadbeef.svg');
    expect(printFilename(1, 7)).toBe('hexforge-7p-00000001.svg');
  });

  it('handles a negative seed as unsigned', () => {
    expect(printFilename(-1, 7)).toBe('hexforge-7p-ffffffff.svg');
  });
});
