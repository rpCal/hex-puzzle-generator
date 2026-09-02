import { defineConfig, devices } from '@playwright/test';
import { webgpuChromiumArgs } from './tools/webgpu-launch.ts';

const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  ...(process.env['CI'] ? { workers: 2 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // SwiftShader and real hardware do not agree bit-for-bit on float rasterisation. Visual
      // assertions are deliberately tolerant; anything that must be exact is asserted by reading
      // integers back from a storage buffer instead of by comparing images.
      maxDiffPixelRatio: 0.02,
      threshold: 0.25,
    },
  },
  use: {
    // Secure context. `navigator.gpu` is undefined on opaque origins.
    baseURL: `http://localhost:${PORT}/hex-puzzle-generator/`,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: webgpuChromiumArgs() },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port ' + PORT + ' --strictPort',
    url: `http://localhost:${PORT}/hex-puzzle-generator/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
