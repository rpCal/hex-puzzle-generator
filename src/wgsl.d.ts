/**
 * WGSL files are loaded by tools/vite-plugin-wgsl.ts, which resolves `#include` directives and
 * emits the composed source as the default export.
 */
declare module '*.wgsl' {
  const source: string;
  export default source;
}
