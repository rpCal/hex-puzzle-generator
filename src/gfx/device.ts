/**
 * WebGPU bootstrap.
 *
 * There is deliberately no WebGL fallback. WebGPU reached Baseline in January 2026 — Chrome and
 * Edge since 113, Firefox 141 on Windows and 145 on Apple Silicon, Safari 26 across macOS, iOS,
 * iPadOS and visionOS. A second renderer would double the surface area of every visual bug to serve
 * a shrinking minority, and it would have to be a *worse* renderer, so the whole design would bend
 * around it. Browsers without WebGPU get an honest, designed capability screen instead, which is
 * what `GpuFailure` exists to describe.
 */

export interface GpuContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly info: GpuInfo;
}

export interface GpuInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  /** True when the adapter is a CPU implementation such as SwiftShader. */
  readonly isFallback: boolean;
  readonly maxTextureDimension2D: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
  readonly features: readonly string[];
}

export type GpuFailureReason =
  | 'no-webgpu'
  | 'no-adapter'
  | 'no-device'
  | 'no-canvas-context'
  | 'insufficient-limits'
  | 'device-lost';

export class GpuFailure extends Error {
  readonly reason: GpuFailureReason;
  readonly detail: string;

  constructor(reason: GpuFailureReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'GpuFailure';
    this.reason = reason;
    this.detail = detail;
  }

  /** Text intended to be shown to a player, not logged. */
  get playerMessage(): string {
    switch (this.reason) {
      case 'no-webgpu':
        return 'This browser does not support WebGPU yet.';
      case 'no-adapter':
        return 'No compatible graphics adapter was available.';
      case 'no-device':
      case 'device-lost':
        return 'The graphics device could not be started.';
      case 'no-canvas-context':
        return 'The page could not create a WebGPU canvas.';
      case 'insufficient-limits':
        return 'This device does not meet the minimum graphics requirements.';
    }
  }
}

/**
 * Limits the renderer genuinely needs.
 *
 * Requested rather than assumed, so that a device which cannot meet them fails loudly at startup
 * with a nameable reason instead of producing corrupted geometry a thousand frames later.
 * `maxStorageBufferBindingSize` is sized for the largest board: 1027 pieces at 64 bytes of piece
 * data, plus generous headroom for the particle system.
 */
export const REQUIRED_LIMITS = {
  maxTextureDimension2D: 4096,
  maxStorageBufferBindingSize: 8 * 1024 * 1024,
  maxBufferSize: 32 * 1024 * 1024,
  maxVertexBuffers: 1,
  maxColorAttachments: 2,
} as const satisfies Record<string, number>;

export interface RequestGpuOptions {
  readonly canvas: HTMLCanvasElement;
  readonly powerPreference?: GPUPowerPreference;
  /** Called if the device is lost after startup. */
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  /** Called for every uncaptured validation or out-of-memory error. */
  readonly onError?: (error: GPUError) => void;
}

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu !== undefined;
}

export async function requestGpu(options: RequestGpuOptions): Promise<GpuContext> {
  if (!isWebGpuAvailable()) {
    // `navigator.gpu` is also undefined in a non-secure context, which is the usual cause when a
    // developer sees this on a page served over plain http from a non-localhost origin.
    throw new GpuFailure(
      'no-webgpu',
      typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext
        ? 'navigator.gpu is unavailable; the page is not in a secure context'
        : 'navigator.gpu is unavailable',
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: options.powerPreference ?? 'high-performance',
  });
  if (adapter === null) throw new GpuFailure('no-adapter', 'requestAdapter() returned null');

  const unmet = Object.entries(REQUIRED_LIMITS).filter(
    ([key, value]) => (adapter.limits[key as keyof GPUSupportedLimits] as number) < value,
  );
  if (unmet.length > 0) {
    throw new GpuFailure(
      'insufficient-limits',
      unmet.map(([key, value]) => `${key} < ${value}`).join(', '),
    );
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredLimits: { ...REQUIRED_LIMITS },
      label: 'hexforge',
    });
  } catch (error) {
    throw new GpuFailure('no-device', error instanceof Error ? error.message : String(error));
  }

  if (options.onDeviceLost !== undefined) {
    void device.lost.then(options.onDeviceLost);
  }
  if (options.onError !== undefined) {
    device.addEventListener('uncapturederror', (event) => {
      options.onError?.((event as GPUUncapturedErrorEvent).error);
    });
  }

  const context = options.canvas.getContext('webgpu');
  if (context === null) throw new GpuFailure('no-canvas-context', "getContext('webgpu') returned null");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  return {
    adapter,
    device,
    canvas: options.canvas,
    context,
    format,
    info: describeAdapter(adapter, device),
  };
}

export function describeAdapter(adapter: GPUAdapter, device: GPUDevice): GpuInfo {
  const info: Partial<GPUAdapterInfo> = adapter.info ?? {};
  const architecture = info.architecture ?? '';
  const vendor = info.vendor ?? '';
  return {
    vendor,
    architecture,
    device: info.device ?? '',
    description: info.description ?? '',
    // SwiftShader is what runs in CI and on machines with no usable GPU. Knowing which one we are
    // on is what lets the perf test skip honestly instead of reporting a meaningless number.
    isFallback: /swiftshader|llvmpipe|lavapipe|software|warp/i.test(`${vendor} ${architecture} ${info.description ?? ''}`),
    maxTextureDimension2D: device.limits.maxTextureDimension2D,
    maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
    maxBufferSize: device.limits.maxBufferSize,
    features: [...device.features],
  };
}

/**
 * Compile a shader and surface any diagnostics.
 *
 * WGSL compilation errors are reported asynchronously and are otherwise easy to miss — the pipeline
 * simply produces nothing. Every shader in the project goes through here, and a GPU test compiles
 * all of them and asserts zero errors.
 */
export async function createShaderModule(
  device: GPUDevice,
  code: string,
  label: string,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    const detail = errors.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n');
    throw new Error(`WGSL compilation failed\n${detail}`);
  }
  return module;
}

/** Round `value` up to a multiple of `alignment`. Buffer sizes and offsets have hard alignment rules. */
export function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
