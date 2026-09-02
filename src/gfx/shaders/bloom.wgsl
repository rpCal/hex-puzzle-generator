#include "./common.wgsl"

// Bloom, kept deliberately small: a bright-pass at half resolution followed by one separable
// Gaussian. A full dual-filter pyramid would look marginally better and cost several more render
// targets; at the sizes this game draws at, the difference is not visible, and the CI renderer is a
// CPU rasteriser that pays for every one of those passes.

// Only what the pass actually reads. `layout: "auto"` derives a bind group layout from the
// bindings a shader *statically uses*, so declaring an unused uniform here would silently drop it
// from the layout and make any bind group that supplies it invalid.
@group(0) @binding(0) var src_texture: texture_2d<f32>;
@group(0) @binding(1) var src_sampler: sampler;

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

const THRESHOLD = 0.85;
const KNEE = 0.35;

// Soft knee: a hard cut-off makes bloom pop on and off as a highlight crosses the threshold.
@fragment
fn fs_prefilter(in: VertexOut) -> @location(0) vec4f {
  let colour = textureSample(src_texture, src_sampler, in.uv).rgb;
  let brightness = max(colour.r, max(colour.g, colour.b));
  let soft = clamp(brightness - THRESHOLD + KNEE, 0.0, 2.0 * KNEE);
  let contribution = max(soft * soft / (4.0 * KNEE + 1e-5), brightness - THRESHOLD);
  return vec4f(colour * (contribution / max(brightness, 1e-5)), 1.0);
}

// Nine-tap Gaussian, weights for sigma ~= 2.
const WEIGHTS = array<f32, 5>(0.227027, 0.194594, 0.121621, 0.054054, 0.016216);

fn blur(uv: vec2f, direction: vec2f) -> vec4f {
  let texel = 1.0 / vec2f(textureDimensions(src_texture, 0));
  var sum = textureSample(src_texture, src_sampler, uv).rgb * 0.227027;
  var weights = WEIGHTS;
  for (var i = 1; i < 5; i = i + 1) {
    let offset = direction * texel * f32(i);
    sum += textureSample(src_texture, src_sampler, uv + offset).rgb * weights[i];
    sum += textureSample(src_texture, src_sampler, uv - offset).rgb * weights[i];
  }
  return vec4f(sum, 1.0);
}

@fragment
fn fs_blur_h(in: VertexOut) -> @location(0) vec4f {
  return blur(in.uv, vec2f(1.0, 0.0));
}

@fragment
fn fs_blur_v(in: VertexOut) -> @location(0) vec4f {
  return blur(in.uv, vec2f(0.0, 1.0));
}

// A straight copy. Used to paint the source image into the small reference thumbnail: a second
// canvas on the same device costs one blit, where reading the texture back to the CPU and pushing
// it through an ImageData would cost a four-megabyte round trip for a 132-pixel preview.
@fragment
fn fs_copy(in: VertexOut) -> @location(0) vec4f {
  return vec4f(textureSample(src_texture, src_sampler, in.uv).rgb, 1.0);
}
