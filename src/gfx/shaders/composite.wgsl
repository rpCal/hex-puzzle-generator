#include "./common.wgsl"

// Final pass: HDR scene plus bloom, tonemapped, vignetted and grained, into the swapchain.

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var bloom_texture: texture_2d<f32>;
@group(0) @binding(2) var linear_sampler: sampler;
@group(0) @binding(3) var<uniform> globals: Globals;

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var out: VertexOut;
  out.clip = fullscreen_position(index);
  out.uv = fullscreen_uv(index);
  return out;
}

// ACES filmic approximation (Krzysztof Narkowicz). Keeps highlights from clipping to flat white,
// which matters here because the snap flash is deliberately over-bright.
fn tonemap(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let exposure = globals.params.x;
  let vignette_strength = globals.params.y;
  let grain_strength = globals.params.z;
  let bloom_strength = globals.params.w;

  let scene = textureSample(scene_texture, linear_sampler, in.uv).rgb;
  let bloom = textureSample(bloom_texture, linear_sampler, in.uv).rgb;

  var colour = scene + bloom * bloom_strength;
  colour *= exposure;
  colour = tonemap(colour);

  // Vignette, computed on aspect-corrected coordinates so it stays circular on wide viewports.
  let aspect = globals.cam1.z / max(globals.cam1.w, 1.0);
  let centred = (in.uv - 0.5) * vec2f(aspect, 1.0);
  let vignette = 1.0 - vignette_strength * dot(centred, centred);
  colour *= clamp(vignette, 0.0, 1.0);

  // Animated grain. Breaks up the banding that a large, nearly flat dark board would otherwise
  // show on 8-bit output, and gives the board a papery surface.
  let seed = bitcast<u32>(in.uv.x * 1237.0 + in.uv.y * 7919.0 + globals.time.x * 61.0);
  let grain = rand_u(seed) - 0.5;
  colour += grain * grain_strength;

  return vec4f(colour, 1.0);
}
