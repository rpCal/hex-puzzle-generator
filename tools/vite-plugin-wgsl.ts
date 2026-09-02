import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Minimal WGSL loader for Vite.
 *
 * Why not `vite-plugin-glsl`: this project needs shader sources importable as plain text from a
 * Node-environment Vitest run (for static checks that need no GPU), and a `#include` mechanism that
 * resolves relative to the including file. That is ~60 lines. A dependency would be more surface
 * area than the code it replaces, and this project ships zero runtime dependencies by policy.
 *
 * Supported directive, one per line:
 *
 *   #include "./common/hex.wgsl"
 *
 * Includes are resolved relative to the including file, deduplicated (a file included twice is
 * inlined once), and cycle-guarded with a readable error naming the cycle.
 */

const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

export interface ResolvedShader {
  /** Fully composed WGSL source with every `#include` inlined. */
  code: string;
  /** Absolute paths of every file that contributed, for HMR watching. */
  deps: string[];
}

/**
 * Compose a WGSL file and everything it includes. Exported separately from the plugin so tests can
 * call it directly without spinning up Vite.
 */
export function composeWgsl(entry: string): ResolvedShader {
  const deps: string[] = [];
  const emitted = new Set<string>();

  const walk = (file: string, stack: string[]): string => {
    if (stack.includes(file)) {
      throw new Error(`WGSL include cycle: ${[...stack, file].join(' -> ')}`);
    }
    if (!existsSync(file)) {
      const from = stack.at(-1);
      throw new Error(`WGSL include not found: ${file}${from ? ` (from ${from})` : ''}`);
    }
    deps.push(file);

    const source = readFileSync(file, 'utf8');
    const dir = dirname(file);

    return source.replace(INCLUDE, (_match: string, spec: string) => {
      const target = resolvePath(dir, spec);
      if (emitted.has(target)) return `// (already included: ${spec})`;
      emitted.add(target);
      const body = walk(target, [...stack, file]);
      return `// >>> ${spec}\n${body}\n// <<< ${spec}`;
    });
  };

  return { code: walk(entry, []), deps };
}

export function wgsl(): Plugin {
  return {
    name: 'hexforge:wgsl',
    transform(_source, id) {
      if (!id.endsWith('.wgsl')) return null;
      const { code, deps } = composeWgsl(id);
      for (const dep of deps) this.addWatchFile(dep);
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: { mappings: '' },
      };
    },
  };
}

export default wgsl;
