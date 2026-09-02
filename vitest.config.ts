import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath, URL } from 'node:url';
import wgsl from './tools/vite-plugin-wgsl.ts';
import { webgpuChromiumArgs } from './tools/webgpu-launch.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  '@core': here('./src/core'),
  '@gfx': here('./src/gfx'),
  '@game': here('./src/game'),
  '@ui': here('./src/ui'),
};

export default defineConfig({
  plugins: [wgsl()],
  resolve: { alias },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/core/**/*.ts'],
      // The rules of the game are pure functions with no excuse for being untested. This gate is
      // what keeps SPEC §2's "core stays pure" rule worth having.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
    projects: [
      {
        plugins: [wgsl()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        plugins: [wgsl()],
        resolve: { alias },
        test: {
          name: 'gpu',
          include: ['tests/gpu/**/*.test.ts'],
          // One file at a time: each holds its own SwiftShader device, and several at once is the
          // memory pressure that takes the GPU process down on a CI runner.
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            instances: [
              {
                browser: 'chromium',
                provider: playwright({
                  // Verified working in headless CI on machines with no GPU. See
                  // docs/RESEARCH.md §2.2 and tools/webgpu-launch.ts — this is the only one of
                  // four probed flag sets that yields a stable adapter plus working compute
                  // readback under SwiftShader.
                  launchOptions: { args: webgpuChromiumArgs() },
                }),
              },
            ],
          },
        },
      },
    ],
  },
});
