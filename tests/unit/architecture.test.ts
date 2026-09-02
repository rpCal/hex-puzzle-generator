import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, URL as NodeUrl } from 'node:url';

/**
 * The dependency rule, enforced.
 *
 * SPEC 2 states the layering: `core` imports nothing from the project, `gfx` may import `core`,
 * `game` may import `core` and `gfx`, `ui` may import `core` and `game`. That rule is what keeps
 * the rules of the game testable without a GPU or a DOM — and a rule nothing checks is a rule that
 * decays. Written as a test rather than a lint plugin so it runs in the same command as everything
 * else and fails just as loudly.
 */

const SRC = fileURLToPath(new NodeUrl('../../src', import.meta.url));

type Layer = 'core' | 'gfx' | 'game' | 'ui' | 'print' | 'pwa';

/**
 * What each layer is allowed to reach into.
 *
 * `print` sits beside `gfx` rather than above it: exporting the cut pattern needs the cut and
 * nothing else, so it depends only on `core`. `ui` may drive it, because exporting is something a
 * player asks for from a button.
 */
const ALLOWED: Record<Layer, readonly Layer[]> = {
  core: [],
  gfx: ['core'],
  print: ['core'],
  game: ['core', 'gfx'],
  ui: ['core', 'game', 'print'],
  pwa: [],
};

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

/** Which layer a source file belongs to, or null if it sits outside the layered tree. */
function layerOf(file: string): Layer | null {
  const rel = relative(SRC, file).replaceAll('\\', '/');
  const top = rel.split('/')[0];
  return top !== undefined && top in ALLOWED ? (top as Layer) : null;
}

/** Which layer an import resolves into, or null for anything outside `src`. */
function targetLayer(fromFile: string, spec: string): Layer | null {
  if (spec.startsWith('@')) {
    const alias = spec.slice(1).split('/')[0];
    return alias !== undefined && alias in ALLOWED ? (alias as Layer) : null;
  }
  if (!spec.startsWith('.')) return null;
  const resolved = resolve(dirname(fromFile), spec);
  if (!resolved.startsWith(SRC)) return null;
  return layerOf(resolved);
}

const FILES = walk(SRC);

describe('layering', () => {
  it('has source files to check', () => {
    // A silently empty scan would make every assertion below vacuously true.
    expect(FILES.length).toBeGreaterThan(5);
  });

  it('never lets a layer import upward', () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const from = layerOf(file);
      if (from === null) continue;
      for (const spec of importsOf(file)) {
        const to = targetLayer(file, spec);
        if (to === null || to === from) continue;
        if (!ALLOWED[from].includes(to)) {
          violations.push(`${relative(SRC, file)} (${from}) -> ${spec} (${to})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps core free of every project dependency', () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (layerOf(file) !== 'core') continue;
      for (const spec of importsOf(file)) {
        if (targetLayer(file, spec) !== null && targetLayer(file, spec) !== 'core') {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps core free of DOM, GPU and Node APIs', () => {
    // If any of these appear, the "solve a board in a unit test" property is already gone.
    const banned = [
      /\bdocument\b/,
      /\bwindow\b/,
      /\bnavigator\b/,
      /\bGPUDevice\b/,
      /\blocalStorage\b/,
      /\bHTMLCanvasElement\b/,
      /from\s+['"]node:/,
    ];
    const violations: string[] = [];
    for (const file of FILES) {
      if (layerOf(file) !== 'core') continue;
      const source = readFileSync(file, 'utf8');
      for (const pattern of banned) {
        if (pattern.test(source)) violations.push(`${relative(SRC, file)} matches ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('uses explicit .ts extensions on every relative import', () => {
    // verbatimModuleSyntax plus bundler resolution means an extensionless relative import is a
    // silent runtime failure in some toolchains and fine in others. Pick one and enforce it.
    const violations: string[] = [];
    for (const file of FILES) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.') && !spec.endsWith('.ts') && !spec.endsWith('.wgsl')) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no runtime dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new NodeUrl('../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
