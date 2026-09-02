import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Compile every shader in the project against a real WebGPU device.
 *
 * This is the highest-value GPU test there is. A WGSL error does not throw: `createShaderModule`
 * returns a module, the pipeline is created, the draw executes, and nothing appears on screen. The
 * diagnostics live behind an async `getCompilationInfo()` that is easy never to call. So the whole
 * shader tree is enumerated and compiled here, and any `error` message fails the build.
 *
 * It runs headless in CI on a machine with no GPU — see docs/RESEARCH.md §2.2 for the flag set that
 * makes that possible, and tools/webgpu-launch.ts for the flags themselves.
 */

const SHADERS = import.meta.glob('/src/gfx/shaders/*.wgsl', { eager: true }) as Record<
  string,
  { default: string }
>;

let device: GPUDevice;

beforeAll(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('no WebGPU adapter');
  device = await adapter.requestDevice();
});

afterAll(() => {
});

describe('shader tree', () => {
  it('finds the shaders', () => {
    // A glob that silently matched nothing would make every case below vacuously pass.
    const names = Object.keys(SHADERS);
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names.some((n) => n.endsWith('piece.wgsl'))).toBe(true);
    expect(names.some((n) => n.endsWith('cluster.wgsl'))).toBe(true);
    expect(names.some((n) => n.endsWith('composite.wgsl'))).toBe(true);
  });

  it('resolves #include directives before compiling', () => {
    const piece = SHADERS['/src/gfx/shaders/piece.wgsl']?.default ?? '';
    expect(piece).toContain('struct Globals');
    expect(piece).toContain('>>> ./common.wgsl');
    // Match the directive at line start; `#include` also appears inside a doc comment.
    expect(piece).not.toMatch(/^[ \t]*#include/m);
  });

  it('includes each file only once, however many times it is pulled in', () => {
    const piece = SHADERS['/src/gfx/shaders/piece.wgsl']?.default ?? '';
    const declarations = piece.match(/struct Globals \{/g) ?? [];
    expect(declarations).toHaveLength(1);
  });
});

describe.each(Object.entries(SHADERS))('%s', (name, module) => {
  it('compiles with zero errors', async () => {
    const shader = device.createShaderModule({ code: module.default, label: name });
    const info = await shader.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    const report = errors.map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`).join('\n');
    expect(report).toBe('');
    expect(errors).toHaveLength(0);
  });

  it('produces no compilation warnings either', async () => {
    // Warnings in WGSL are usually a genuine mistake -- an unreachable branch, a shadowed
    // declaration -- and there are few enough shaders here to keep the bar at zero.
    const shader = device.createShaderModule({ code: module.default, label: name });
    const info = await shader.getCompilationInfo();
    const warnings = info.messages.filter((m) => m.type === 'warning');
    const report = warnings.map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`).join('\n');
    expect(report).toBe('');
  });
});
