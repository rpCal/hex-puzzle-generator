/**
 * Chromium launch flags that make WebGPU available in headless CI on machines with no GPU.
 *
 * These are not guesswork. Four configurations were probed against Playwright 1.62.1 before any
 * application code was written (docs/RESEARCH.md §2.2):
 *
 *   A  (no flags)                                  -> requestAdapter() returns null
 *   B  --enable-unsafe-swiftshader                 -> requestAdapter() returns null
 *   C  --enable-unsafe-webgpu + B                  -> adapter obtained, then
 *                                                     "OperationError: A valid external Instance
 *                                                      reference no longer exists" -- unstable
 *   D  the set below                               -> adapter { vendor: "google",
 *                                                     architecture: "swiftshader" },
 *                                                     compute readback correct,
 *                                                     render-to-canvas works,
 *                                                     maxTextureDimension2D = 8192
 *
 * Two further constraints established at the same time:
 *
 *  - `navigator.gpu` requires a **secure context**. `data:` URLs are opaque origins and expose no
 *    `navigator.gpu` at all; `http://localhost` does. Never navigate a GPU test to a data URL.
 *  - WebGPU canvas content *is* composited into `page.screenshot()` under this configuration,
 *    which is what makes visual regression and the generated README media possible.
 */
export const WEBGPU_CHROMIUM_ARGS: readonly string[] = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-vulkan=swiftshader',
  '--enable-unsafe-swiftshader',
  // Container stability, not WebGPU configuration.
  //
  // CI runners give Chromium a 64 MB /dev/shm. SwiftShader allocates its render targets and
  // staging buffers there, exhausts it, and the GPU process dies -- which surfaces much later and
  // much more confusingly as `mapAsync` rejecting with "A valid external Instance reference no
  // longer exists" from whatever readback happened to be in flight. Falling back to /tmp costs
  // nothing and removes the whole failure mode.
  '--disable-dev-shm-usage',
  // A crashed GPU process is otherwise relaunched into a state the existing device cannot use.
  '--disable-gpu-process-crash-limit',
];

/** Mutable copy, for APIs that insist on `string[]`. */
export const webgpuChromiumArgs = (): string[] => [...WEBGPU_CHROMIUM_ARGS];
