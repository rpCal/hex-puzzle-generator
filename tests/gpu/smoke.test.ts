import { describe, it, expect } from 'vitest';

/**
 * Infrastructure smoke test. Proves Vitest browser mode reaches a real WebGPU device before any
 * of the project's own GPU code depends on it.
 */
describe('webgpu availability under vitest browser mode', () => {
  it('exposes navigator.gpu in a secure context', () => {
    expect(globalThis.isSecureContext).toBe(true);
    expect(navigator.gpu).toBeDefined();
  });

  it('acquires an adapter and a device', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    expect(adapter).not.toBeNull();
    const device = await adapter!.requestDevice();
    expect(device).toBeDefined();
    expect(device.limits.maxTextureDimension2D).toBeGreaterThanOrEqual(4096);
  });

  it('round-trips a compute shader through a storage buffer', async () => {
    const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    const module = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> data: array<u32>;
        @compute @workgroup_size(8) fn main(@builtin(global_invocation_id) id: vec3u) {
          data[id.x] = id.x * 3u + 1u;
        }`,
    });
    const size = 32;
    const storage = device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: storage } }],
      }),
    );
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(storage, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const out = Array.from(new Uint32Array(readback.getMappedRange().slice(0)));
    readback.unmap();

    expect(out.slice(0, 4)).toEqual([1, 4, 7, 10]);
  });
});
