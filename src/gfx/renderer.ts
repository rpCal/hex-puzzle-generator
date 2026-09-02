import type { CutBoard } from '@core/cut/board.ts';
import { buildBoardMesh, buildPieceStatics, PIECE_DATA_STRIDE, VERTEX_STRIDE } from '@core/cut/mesh.ts';
import type { Affine2D } from '@core/math/affine2d.ts';
import { createShaderModule, type GpuContext } from './device.ts';

import commonWgsl from './shaders/common.wgsl';
import pieceWgsl from './shaders/piece.wgsl';
import clusterWgsl from './shaders/cluster.wgsl';
import artWgsl from './shaders/art.wgsl';
import bloomWgsl from './shaders/bloom.wgsl';
import compositeWgsl from './shaders/composite.wgsl';
import particleSimWgsl from './shaders/particle_sim.wgsl';
import particleDrawWgsl from './shaders/particle_draw.wgsl';

void commonWgsl; // included by the others; imported so the bundler tracks it as a dependency

/**
 * The frame graph.
 *
 *   [compute] cluster       cluster transforms -> per-piece render data
 *   [compute] particle sim  integrate the snap sparks
 *   [render]  pieces        one indexed draw, 2 instances (shadow + piece)
 *                           -> HDR colour + r32uint piece ids + depth
 *   [render]  particles     additive, into the same HDR target
 *   [render]  bloom         bright pass at half res, then separable blur
 *   [render]  composite     tonemap + bloom + vignette + grain -> swapchain
 */

export const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
export const PICK_FORMAT: GPUTextureFormat = 'r32uint';
export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/** Floats per cluster in the cluster storage buffer. Must match `ClusterXform` in cluster.wgsl. */
export const CLUSTER_STRIDE_FLOATS = 8;
/** Floats per particle. Must match `Particle` in particle_common.wgsl. */
export const PARTICLE_STRIDE_FLOATS = 12;

export const ART_SIZE = 1024;
export const DEFAULT_PARTICLE_CAPACITY = 4096;

export interface RendererOptions {
  readonly particleCapacity?: number;
  readonly artSize?: number;
}

/** Everything the renderer needs to draw one frame. Plain data; the renderer owns no game state. */
export interface FrameState {
  /** World -> clip. The camera builds it; see game/camera.ts. */
  readonly viewProjection: Affine2D;
  /** `CLUSTER_STRIDE_FLOATS` per cluster: position xy, anchorSolved xy, rotation, depth, alpha, highlight. */
  readonly clusters: Float32Array;
  readonly clusterCount: number;
  /** Which cluster slot each piece belongs to. */
  readonly pieceCluster: Uint32Array;
  /** Cluster slot currently held, or `0xffffffff` for none. */
  readonly heldCluster: number;
  readonly timeSeconds: number;
  readonly deltaSeconds: number;
  /** 1 = cut shading fully visible, 0 = seamless picture. Drives the completion reveal. */
  readonly reveal: number;
  /** Global highlight tint, rgb. */
  readonly tint: readonly [number, number, number];
  readonly exposure?: number;
  readonly vignette?: number;
  readonly grain?: number;
  readonly bloom?: number;
}

interface Targets {
  width: number;
  height: number;
  scene: GPUTexture;
  sceneView: GPUTextureView;
  pick: GPUTexture;
  pickView: GPUTextureView;
  depth: GPUTexture;
  depthView: GPUTextureView;
  bloomA: GPUTexture;
  bloomAView: GPUTextureView;
  bloomB: GPUTexture;
  bloomBView: GPUTextureView;
}

interface BoardResources {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  pieceCount: number;
  pieceStatic: GPUBuffer;
  pieceData: GPUBuffer;
  pieceCluster: GPUBuffer;
  clusters: GPUBuffer;
  clusterCapacity: number;
  computeBindGroup: GPUBindGroup;
  drawBindGroup: GPUBindGroup;
  boardBounds: readonly [number, number, number, number];
  triangleCount: number;
}

export class Renderer {
  readonly gpu: GpuContext;
  readonly particleCapacity: number;
  readonly artSize: number;

  #targets: Targets | null = null;
  #board: BoardResources | null = null;

  #globals!: GPUBuffer;
  #clusterUniform!: GPUBuffer;
  #simUniform!: GPUBuffer;
  #artUniform!: GPUBuffer;
  #particles!: GPUBuffer;
  #pickStaging!: GPUBuffer;

  #artTexture!: GPUTexture;
  #artView!: GPUTextureView;
  #sampler!: GPUSampler;

  #piecePipeline!: GPURenderPipeline;
  #clusterPipeline!: GPUComputePipeline;
  #artPipeline!: GPURenderPipeline;
  #particleSimPipeline!: GPUComputePipeline;
  #particleDrawPipeline!: GPURenderPipeline;
  #bloomPrefilter!: GPURenderPipeline;
  #bloomBlurH!: GPURenderPipeline;
  #bloomBlurV!: GPURenderPipeline;
  #bloomLayout!: GPUBindGroupLayout;
  #compositePipeline!: GPURenderPipeline;

  #particleSimBind!: GPUBindGroup;
  #particleDrawBind!: GPUBindGroup;
  #artBind!: GPUBindGroup;
  #bloomFromScene: GPUBindGroup | null = null;
  #bloomFromA: GPUBindGroup | null = null;
  #bloomFromB: GPUBindGroup | null = null;
  #compositeBind: GPUBindGroup | null = null;

  #pickInFlight = false;
  #scratchGlobals = new Float32Array(20);

  private constructor(gpu: GpuContext, options: RendererOptions) {
    this.gpu = gpu;
    this.particleCapacity = options.particleCapacity ?? DEFAULT_PARTICLE_CAPACITY;
    this.artSize = options.artSize ?? ART_SIZE;
  }

  static async create(gpu: GpuContext, options: RendererOptions = {}): Promise<Renderer> {
    const renderer = new Renderer(gpu, options);
    await renderer.#init();
    return renderer;
  }

  async #init(): Promise<void> {
    const { device } = this.gpu;

    const [pieceModule, clusterModule, artModule, bloomModule, compositeModule, simModule, drawModule] =
      await Promise.all([
        createShaderModule(device, pieceWgsl, 'piece.wgsl'),
        createShaderModule(device, clusterWgsl, 'cluster.wgsl'),
        createShaderModule(device, artWgsl, 'art.wgsl'),
        createShaderModule(device, bloomWgsl, 'bloom.wgsl'),
        createShaderModule(device, compositeWgsl, 'composite.wgsl'),
        createShaderModule(device, particleSimWgsl, 'particle_sim.wgsl'),
        createShaderModule(device, particleDrawWgsl, 'particle_draw.wgsl'),
      ]);

    this.#globals = device.createBuffer({
      label: 'globals',
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#clusterUniform = device.createBuffer({
      label: 'cluster-uniform',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#simUniform = device.createBuffer({
      label: 'sim-uniform',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#artUniform = device.createBuffer({
      label: 'art-uniform',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#particles = device.createBuffer({
      label: 'particles',
      size: this.particleCapacity * PARTICLE_STRIDE_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#pickStaging = device.createBuffer({
      label: 'pick-staging',
      size: 256,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.#artTexture = device.createTexture({
      label: 'art',
      size: [this.artSize, this.artSize],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST,
    });
    this.#artView = this.#artTexture.createView();
    this.#sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.#piecePipeline = device.createRenderPipeline({
      label: 'pieces',
      layout: 'auto',
      vertex: {
        module: pieceModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: VERTEX_STRIDE,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32' },
              { shaderLocation: 2, offset: 12, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: pieceModule,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR_FORMAT,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
          // r32uint is renderable but neither blendable nor multisampleable, which is exactly why
          // the anti-aliasing is analytic rather than MSAA.
          { format: PICK_FORMAT },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
    });

    this.#clusterPipeline = device.createComputePipeline({
      label: 'cluster-expand',
      layout: 'auto',
      compute: { module: clusterModule, entryPoint: 'main' },
    });

    this.#artPipeline = device.createRenderPipeline({
      label: 'art',
      layout: 'auto',
      vertex: { module: artModule, entryPoint: 'vs' },
      fragment: { module: artModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.#artBind = device.createBindGroup({
      layout: this.#artPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.#artUniform } }],
    });

    this.#particleSimPipeline = device.createComputePipeline({
      label: 'particle-sim',
      layout: 'auto',
      compute: { module: simModule, entryPoint: 'simulate' },
    });
    this.#particleSimBind = device.createBindGroup({
      layout: this.#particleSimPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#particles } },
        { binding: 1, resource: { buffer: this.#simUniform } },
      ],
    });

    this.#particleDrawPipeline = device.createRenderPipeline({
      label: 'particle-draw',
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'vs' },
      fragment: {
        module: drawModule,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.#particleDrawBind = device.createBindGroup({
      layout: this.#particleDrawPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#particles } },
        { binding: 1, resource: { buffer: this.#globals } },
      ],
    });

    // The three bloom passes share one bind group layout, declared explicitly rather than derived.
    // `layout: "auto"` produces a *distinct* layout object per pipeline even when the bindings are
    // identical, so a bind group built for one pipeline is rejected by the next -- and the error
    // arrives as an invalidated command buffer, which silently drops every other pass in the frame
    // along with it.
    this.#bloomLayout = device.createBindGroupLayout({
      label: 'bloom',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const bloomPipelineLayout = device.createPipelineLayout({
      label: 'bloom',
      bindGroupLayouts: [this.#bloomLayout],
    });

    const postTargets = [{ format: HDR_FORMAT }];
    const bloomPipeline = (label: string, entryPoint: string): GPURenderPipeline =>
      device.createRenderPipeline({
        label,
        layout: bloomPipelineLayout,
        vertex: { module: bloomModule, entryPoint: 'vs' },
        fragment: { module: bloomModule, entryPoint, targets: postTargets },
        primitive: { topology: 'triangle-list' },
      });

    this.#bloomPrefilter = bloomPipeline('bloom-prefilter', 'fs_prefilter');
    this.#bloomBlurH = bloomPipeline('bloom-blur-h', 'fs_blur_h');
    this.#bloomBlurV = bloomPipeline('bloom-blur-v', 'fs_blur_v');
    this.#compositePipeline = device.createRenderPipeline({
      label: 'composite',
      layout: 'auto',
      vertex: { module: compositeModule, entryPoint: 'vs' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fs',
        targets: [{ format: this.gpu.format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.setArt(0, 0);
  }

  // -------------------------------------------------------------------------------------------
  // Board

  /** Upload a board's geometry. Replaces any previous board. */
  setBoard(board: CutBoard, bevelWidth?: number): void {
    const { device } = this.gpu;
    this.#board?.vertexBuffer.destroy();
    this.#board?.indexBuffer.destroy();
    this.#board?.pieceStatic.destroy();
    this.#board?.pieceData.destroy();
    this.#board?.pieceCluster.destroy();
    this.#board?.clusters.destroy();

    const mesh = buildBoardMesh(board, bevelWidth === undefined ? {} : { bevelWidth });
    const statics = buildPieceStatics(board);
    const pieceCount = board.pieces.length;

    const vertexBuffer = device.createBuffer({
      label: 'board-vertices',
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);

    const indexBuffer = device.createBuffer({
      label: 'board-indices',
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, mesh.indices);

    const pieceStatic = device.createBuffer({
      label: 'piece-static',
      size: statics.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(pieceStatic, 0, statics);

    const pieceData = device.createBuffer({
      label: 'piece-data',
      size: pieceCount * PIECE_DATA_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const pieceCluster = device.createBuffer({
      label: 'piece-cluster',
      size: Math.max(16, pieceCount * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // A board can never have more clusters than pieces, so sizing for the worst case removes any
    // need to reallocate mid-game -- and the worst case is the *start* of every game.
    const clusterCapacity = pieceCount;
    const clusters = device.createBuffer({
      label: 'clusters',
      size: Math.max(32, clusterCapacity * CLUSTER_STRIDE_FLOATS * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const computeBindGroup = device.createBindGroup({
      layout: this.#clusterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: clusters } },
        { binding: 1, resource: { buffer: pieceCluster } },
        { binding: 2, resource: { buffer: pieceStatic } },
        { binding: 3, resource: { buffer: pieceData } },
        { binding: 4, resource: { buffer: this.#clusterUniform } },
      ],
    });

    const drawBindGroup = device.createBindGroup({
      layout: this.#piecePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#globals } },
        { binding: 1, resource: { buffer: pieceData } },
        { binding: 2, resource: this.#artView },
        { binding: 3, resource: this.#sampler },
      ],
    });

    this.#board = {
      vertexBuffer,
      indexBuffer,
      indexCount: mesh.indexCount,
      pieceCount,
      pieceStatic,
      pieceData,
      pieceCluster,
      clusters,
      clusterCapacity,
      computeBindGroup,
      drawBindGroup,
      boardBounds: [
        board.bounds.min.x,
        board.bounds.min.y,
        board.bounds.max.x - board.bounds.min.x,
        board.bounds.max.y - board.bounds.min.y,
      ],
      triangleCount: mesh.triangleCount,
    };
  }

  get triangleCount(): number {
    return this.#board?.triangleCount ?? 0;
  }

  get hasBoard(): boolean {
    return this.#board !== null;
  }

  /** Upload the piece -> cluster slot mapping. Only changes when pieces weld. */
  setPieceClusters(map: Uint32Array): void {
    if (this.#board === null) return;
    this.gpu.device.queue.writeBuffer(this.#board.pieceCluster, 0, map);
  }

  // -------------------------------------------------------------------------------------------
  // Source image

  /** Render one of the built-in procedural images into the art texture. */
  setArt(style: number, seed: number): void {
    const { device } = this.gpu;
    device.queue.writeBuffer(
      this.#artUniform,
      0,
      new Float32Array([style, seed, this.artSize, this.artSize]),
    );

    const encoder = device.createCommandEncoder({ label: 'art' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#artView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.#artPipeline);
    pass.setBindGroup(0, this.#artBind);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** Use a player-supplied image instead. Cover-fits so the aspect ratio is never distorted. */
  setImage(source: ImageBitmap): void {
    const { device } = this.gpu;
    const scale = Math.max(this.artSize / source.width, this.artSize / source.height);
    const width = Math.min(this.artSize, Math.round(source.width * scale));
    const height = Math.min(this.artSize, Math.round(source.height * scale));
    device.queue.copyExternalImageToTexture(
      { source },
      {
        texture: this.#artTexture,
        origin: [Math.floor((this.artSize - width) / 2), Math.floor((this.artSize - height) / 2)],
      },
      [Math.min(width, source.width), Math.min(height, source.height)],
    );
  }

  // -------------------------------------------------------------------------------------------
  // Targets

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.#targets !== null && this.#targets.width === w && this.#targets.height === h) return;

    const { device } = this.gpu;
    this.#destroyTargets();

    const make = (
      label: string,
      format: GPUTextureFormat,
      size: [number, number],
      usage: number,
    ): GPUTexture => device.createTexture({ label, size, format, usage });

    const attachment = GPUTextureUsage.RENDER_ATTACHMENT;
    const sampled = GPUTextureUsage.TEXTURE_BINDING;
    const halfW = Math.max(1, w >> 1);
    const halfH = Math.max(1, h >> 1);

    const scene = make('scene', HDR_FORMAT, [w, h], attachment | sampled);
    const pick = make('pick', PICK_FORMAT, [w, h], attachment | GPUTextureUsage.COPY_SRC);
    const depth = make('depth', DEPTH_FORMAT, [w, h], attachment);
    const bloomA = make('bloom-a', HDR_FORMAT, [halfW, halfH], attachment | sampled);
    const bloomB = make('bloom-b', HDR_FORMAT, [halfW, halfH], attachment | sampled);

    this.#targets = {
      width: w,
      height: h,
      scene,
      sceneView: scene.createView(),
      pick,
      pickView: pick.createView(),
      depth,
      depthView: depth.createView(),
      bloomA,
      bloomAView: bloomA.createView(),
      bloomB,
      bloomBView: bloomB.createView(),
    };

    const bloomBind = (view: GPUTextureView): GPUBindGroup =>
      device.createBindGroup({
        layout: this.#bloomLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: this.#sampler },
        ],
      });

    this.#bloomFromScene = bloomBind(this.#targets.sceneView);
    this.#bloomFromA = bloomBind(this.#targets.bloomAView);
    this.#bloomFromB = bloomBind(this.#targets.bloomBView);
    this.#compositeBind = device.createBindGroup({
      layout: this.#compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#targets.sceneView },
        { binding: 1, resource: this.#targets.bloomAView },
        { binding: 2, resource: this.#sampler },
        { binding: 3, resource: { buffer: this.#globals } },
      ],
    });
  }

  #destroyTargets(): void {
    const t = this.#targets;
    if (t === null) return;
    t.scene.destroy();
    t.pick.destroy();
    t.depth.destroy();
    t.bloomA.destroy();
    t.bloomB.destroy();
    this.#targets = null;
  }

  // -------------------------------------------------------------------------------------------
  // Frame

  render(frame: FrameState): void {
    const board = this.#board;
    const targets = this.#targets;
    if (board === null || targets === null) return;

    const { device } = this.gpu;
    this.#writeGlobals(frame, targets, board);

    device.queue.writeBuffer(
      board.clusters,
      0,
      frame.clusters,
      0,
      Math.min(frame.clusters.length, board.clusterCapacity * CLUSTER_STRIDE_FLOATS),
    );
    device.queue.writeBuffer(
      this.#clusterUniform,
      0,
      new Uint32Array([board.pieceCount, frame.heldCluster >>> 0, 0, 0]),
    );
    device.queue.writeBuffer(
      this.#clusterUniform,
      16,
      new Float32Array([frame.tint[0], frame.tint[1], frame.tint[2], 1]),
    );
    device.queue.writeBuffer(
      this.#simUniform,
      0,
      new Float32Array([frame.deltaSeconds, this.particleCapacity, 90, 0]),
    );

    const encoder = device.createCommandEncoder({ label: 'frame' });

    const compute = encoder.beginComputePass({ label: 'expand' });
    compute.setPipeline(this.#clusterPipeline);
    compute.setBindGroup(0, board.computeBindGroup);
    compute.dispatchWorkgroups(Math.ceil(board.pieceCount / 64));
    compute.setPipeline(this.#particleSimPipeline);
    compute.setBindGroup(0, this.#particleSimBind);
    compute.dispatchWorkgroups(Math.ceil(this.particleCapacity / 64));
    compute.end();

    const scene = encoder.beginRenderPass({
      label: 'pieces',
      colorAttachments: [
        {
          view: targets.sceneView,
          clearValue: { r: 0.028, g: 0.032, b: 0.048, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
        {
          view: targets.pickView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: targets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    scene.setPipeline(this.#piecePipeline);
    scene.setBindGroup(0, board.drawBindGroup);
    scene.setVertexBuffer(0, board.vertexBuffer);
    scene.setIndexBuffer(board.indexBuffer, 'uint32');
    // Instance 0 is the shadow pass, instance 1 the pieces. One call for the whole board.
    scene.drawIndexed(board.indexCount, 2);
    scene.end();

    const sparks = encoder.beginRenderPass({
      label: 'particles',
      colorAttachments: [{ view: targets.sceneView, loadOp: 'load', storeOp: 'store' }],
    });
    sparks.setPipeline(this.#particleDrawPipeline);
    sparks.setBindGroup(0, this.#particleDrawBind);
    sparks.draw(6, this.particleCapacity);
    sparks.end();

    this.#bloomPass(encoder, targets);

    const present = encoder.beginRenderPass({
      label: 'composite',
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    present.setPipeline(this.#compositePipeline);
    present.setBindGroup(0, this.#compositeBind as GPUBindGroup);
    present.draw(3);
    present.end();

    device.queue.submit([encoder.finish()]);
  }

  /**
   * scene -> A (bright pass, half res) -> B (horizontal) -> A (vertical), and the composite reads
   * A. Ping-ponging between two half-resolution targets means no copies and no third texture.
   */
  #bloomPass(encoder: GPUCommandEncoder, targets: Targets): void {
    const run = (
      pipeline: GPURenderPipeline,
      bind: GPUBindGroup,
      view: GPUTextureView,
      label: string,
    ): void => {
      const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [
          { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
    };

    run(this.#bloomPrefilter, this.#bloomFromScene as GPUBindGroup, targets.bloomAView, 'bloom-prefilter');
    run(this.#bloomBlurH, this.#bloomFromA as GPUBindGroup, targets.bloomBView, 'bloom-h');
    run(this.#bloomBlurV, this.#bloomFromB as GPUBindGroup, targets.bloomAView, 'bloom-v');
  }

  #writeGlobals(frame: FrameState, targets: Targets, board: BoardResources): void {
    const g = this.#scratchGlobals;
    const m = frame.viewProjection;
    g[0] = m.a;
    g[1] = m.b;
    g[2] = m.c;
    g[3] = m.d;
    g[4] = m.tx;
    g[5] = m.ty;
    g[6] = targets.width;
    g[7] = targets.height;
    g[8] = board.boardBounds[0];
    g[9] = board.boardBounds[1];
    g[10] = board.boardBounds[2];
    g[11] = board.boardBounds[3];
    g[12] = frame.timeSeconds;
    g[13] = frame.deltaSeconds;
    g[14] = frame.reveal;
    g[15] = 0;
    g[16] = frame.exposure ?? 1.05;
    g[17] = frame.vignette ?? 0.28;
    g[18] = frame.grain ?? 0.012;
    g[19] = frame.bloom ?? 0.55;
    this.gpu.device.queue.writeBuffer(this.#globals, 0, g);
  }

  // -------------------------------------------------------------------------------------------
  // Picking

  /**
   * Which piece is under a pixel, or -1 for none.
   *
   * Reads the single texel of the `r32uint` attachment the last frame wrote. Exact, and correct for
   * overlapping pieces because it uses the z-order the GPU already resolved — no CPU hit-testing
   * against Bezier outlines, and no divergence between what is drawn and what is clicked.
   */
  async pick(x: number, y: number): Promise<number> {
    const targets = this.#targets;
    if (targets === null || this.#pickInFlight) return -1;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= targets.width || py >= targets.height) return -1;

    this.#pickInFlight = true;
    try {
      const { device } = this.gpu;
      const encoder = device.createCommandEncoder({ label: 'pick' });
      encoder.copyTextureToBuffer(
        { texture: targets.pick, origin: { x: px, y: py } },
        { buffer: this.#pickStaging, bytesPerRow: 256 },
        [1, 1],
      );
      device.queue.submit([encoder.finish()]);
      await this.#pickStaging.mapAsync(GPUMapMode.READ);
      const value = new Uint32Array(this.#pickStaging.getMappedRange(0, 4))[0] ?? 0;
      this.#pickStaging.unmap();
      return value === 0 ? -1 : value - 1;
    } finally {
      this.#pickInFlight = false;
    }
  }

  /** Overwrite a range of particle slots. The CPU allocates with a ring cursor and never reads back. */
  writeParticles(firstSlot: number, data: Float32Array): void {
    const slots = data.length / PARTICLE_STRIDE_FLOATS;
    if (slots <= 0) return;
    const start = firstSlot % this.particleCapacity;
    const fits = Math.min(slots, this.particleCapacity - start);
    this.gpu.device.queue.writeBuffer(
      this.#particles,
      start * PARTICLE_STRIDE_FLOATS * 4,
      data,
      0,
      fits * PARTICLE_STRIDE_FLOATS,
    );
    if (fits < slots) {
      this.gpu.device.queue.writeBuffer(
        this.#particles,
        0,
        data,
        fits * PARTICLE_STRIDE_FLOATS,
        (slots - fits) * PARTICLE_STRIDE_FLOATS,
      );
    }
  }

  /** Read the expanded piece data back. Used by the GPU test that compares it to the CPU reference. */
  async readPieceData(): Promise<Float32Array> {
    const board = this.#board;
    if (board === null) return new Float32Array(0);
    const { device } = this.gpu;
    const size = board.pieceCount * PIECE_DATA_STRIDE;
    const staging = device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = device.createCommandEncoder({ label: 'read-piece-data' });
    encoder.copyBufferToBuffer(board.pieceData, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  destroy(): void {
    this.#destroyTargets();
    this.#board?.vertexBuffer.destroy();
    this.#board?.indexBuffer.destroy();
    this.#board?.pieceStatic.destroy();
    this.#board?.pieceData.destroy();
    this.#board?.pieceCluster.destroy();
    this.#board?.clusters.destroy();
    this.#board = null;
    this.#globals.destroy();
    this.#clusterUniform.destroy();
    this.#simUniform.destroy();
    this.#artUniform.destroy();
    this.#particles.destroy();
    this.#pickStaging.destroy();
    this.#artTexture.destroy();
  }
}
