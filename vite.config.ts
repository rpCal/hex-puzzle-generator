import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import wgsl from './tools/vite-plugin-wgsl.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // The site is served from a project subpath on GitHub Pages.
  base: process.env['HEXFORGE_BASE'] ?? '/hex-puzzle-generator/',
  plugins: [wgsl()],
  resolve: {
    alias: {
      '@core': here('./src/core'),
      '@gfx': here('./src/gfx'),
      '@game': here('./src/game'),
      '@ui': here('./src/ui'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssMinify: 'lightningcss',
    // One chunk by default. The whole app is smaller than a typical framework runtime; splitting
    // it would add round-trips for no benefit.
    chunkSizeWarningLimit: 250,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
