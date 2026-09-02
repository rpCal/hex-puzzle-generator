#include "./common.wgsl"

// Procedurally generated source images.
//
// The game ships with bundled art that weighs nothing: every built-in picture is a function of a
// style index and a seed, rendered once into a texture at load. No image files, no download, no
// licence questions, and a shareable puzzle link stays twelve characters because the picture is
// reproducible from its id rather than fetched.

struct ArtUniforms {
  // style index, seed, width, height
  config: vec4f,
}

@group(0) @binding(0) var<uniform> art: ArtUniforms;

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

// Iñigo Quílez's cosine palette. Four vec3 controls give an entire coherent colour scheme.
//
// The amplitudes below are deliberately modest and the per-channel phases deliberately close
// together. Wide phase spread with full amplitude is what produces the saturated primary-and-
// complement look that reads as "shader demo"; keeping the hues analogous and letting luminance
// carry most of the variation is what makes an image look painted. It also makes a better puzzle:
// pieces need local contrast to be matchable, not maximum chroma.
fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

// Domain-warped fbm: smooth, organic, and rich in the mid-frequency detail that makes a jigsaw
// solvable. Flat regions are the enemy of a good puzzle.
fn style_nebula(uv: vec2f, seed: f32) -> vec3f {
  let p = uv * 3.0 + vec2f(seed * 13.7, seed * 7.1);
  let q = vec2f(fbm(p, 5), fbm(p + vec2f(5.2, 1.3), 5));
  let r = vec2f(fbm(p + 4.0 * q + vec2f(1.7, 9.2), 5), fbm(p + 4.0 * q + vec2f(8.3, 2.8), 5));
  let f = fbm(p + 4.0 * r, 5) + 0.22 * fbm(p * 5.3 + r * 2.0, 3);
  // Deep indigo through plum into warm gold where the field peaks.
  let base = palette(
    f * 1.1 + 0.12 * r.x,
    vec3f(0.34, 0.28, 0.40),
    vec3f(0.34, 0.26, 0.32),
    vec3f(1.0, 1.0, 1.0),
    vec3f(0.00, 0.12, 0.26),
  );
  let glow = smoothstep(0.48, 0.92, f);
  return base + vec3f(0.55, 0.38, 0.12) * glow * glow;
}

// Cellular / stained-glass. Hard boundaries give strong local features to match on.
fn style_shards(uv: vec2f, seed: f32) -> vec3f {
  let scale = 7.0;
  let p = uv * scale + vec2f(seed * 3.3, seed * 5.9);
  let cell = floor(p);
  var best = 8.0;
  var second = 8.0;
  var best_cell = cell;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let g = cell + vec2f(f32(x), f32(y));
      let jitter = vec2f(hash21(g), hash21(g + vec2f(31.0, 17.0)));
      let d = length(g + jitter - p);
      if (d < best) {
        second = best;
        best = d;
        best_cell = g;
      } else if (d < second) {
        second = d;
      }
    }
  }
  let tone = hash21(best_cell + vec2f(seed, 0.0));
  let border = smoothstep(0.0, 0.09, second - best);
  // Teal and emerald glass with dark leading between the cells.
  let base = palette(
    tone * 0.8 + 0.1,
    vec3f(0.30, 0.42, 0.40),
    vec3f(0.30, 0.34, 0.28),
    vec3f(1.0, 1.0, 1.0),
    vec3f(0.28, 0.44, 0.58),
  );
  // A little radial shading inside each cell so a flat tile still has somewhere to look.
  let shade = mix(0.72, 1.12, smoothstep(0.0, 0.55, best));
  return base * shade * mix(0.22, 1.0, border);
}

// Flow field: long sweeping strands, high contrast, very readable when cut into small pieces.
fn style_currents(uv: vec2f, seed: f32) -> vec3f {
  var p = uv * 2.2 + vec2f(seed * 2.1, seed * 4.4);
  var accum = 0.0;
  var amp = 1.0;
  for (var i = 0; i < 4; i = i + 1) {
    let angle = fbm(p, 4) * 6.28318;
    p += vec2f(cos(angle), sin(angle)) * 0.28;
    accum += amp * fbm(p * 1.7, 3);
    amp *= 0.62;
  }
  let bands = 0.5 + 0.5 * sin(accum * 7.0 + seed);
  // Copper and cream, banded like oil on water.
  let base = palette(
    accum * 0.45 + bands * 0.18,
    vec3f(0.44, 0.34, 0.26),
    vec3f(0.32, 0.28, 0.24),
    vec3f(1.0, 1.0, 1.0),
    vec3f(0.06, 0.14, 0.30),
  );
  return base + vec3f(0.14, 0.11, 0.06) * bands;
}

// Concentric interference, with enough warp that no two pieces look alike.
fn style_bloom(uv: vec2f, seed: f32) -> vec3f {
  let centre = vec2f(0.5) + vec2f(hash21(vec2f(seed, 1.0)), hash21(vec2f(seed, 2.0))) * 0.3 - 0.15;
  let d = uv - centre;
  let warp = fbm(uv * 4.0 + seed, 4);
  let radius = length(d) * (1.0 + warp * 0.55);
  let angle = atan2(d.y, d.x);
  let rings = 0.5 + 0.5 * sin(radius * 34.0 + angle * 5.0 + warp * 6.0);
  // Rose through violet, lifting to cream at the centre of the interference.
  let base = palette(
    rings * 0.4 + radius * 0.9,
    vec3f(0.44, 0.34, 0.42),
    vec3f(0.32, 0.26, 0.34),
    vec3f(1.0, 1.0, 1.0),
    vec3f(0.54, 0.62, 0.74),
  );
  return base + vec3f(0.20, 0.16, 0.14) * pow(rings, 3.0);
}

/**
 * Turn an arbitrary seed into a small coordinate offset.
 *
 * This is not cosmetic. The noise below takes `floor(p)` and `p - floor(p)`, and float32 spacing at
 * 4e6 is 0.5 -- so feeding a large seed straight in as a coordinate offset quantises the fractional
 * part into steps and the image breaks into hard flat rectangles. Multiplying by the golden ratio
 * and taking the fraction keeps the variation while keeping every coordinate small enough that the
 * interpolation still has bits to work with.
 */
fn seed_offset(seed: f32) -> f32 {
  return fract(seed * 0.6180339887) * 96.0;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let style = i32(art.config.x + 0.5);
  let seed = seed_offset(art.config.y);
  let uv = clamp(in.uv, vec2f(0.0), vec2f(1.0));

  var colour: vec3f;
  if (style == 1) {
    colour = style_shards(uv, seed);
  } else if (style == 2) {
    colour = style_currents(uv, seed);
  } else if (style == 3) {
    colour = style_bloom(uv, seed);
  } else {
    colour = style_nebula(uv, seed);
  }

  // Gentle contrast lift, then clamp. Puzzle art wants strong local variation but no pure black,
  // which would make a piece indistinguishable from the board behind it, and no blown white.
  colour = (colour - 0.5) * 1.32 + 0.5;
  // Pull a little chroma out of the extremes; fully saturated shadows and highlights are the
  // giveaway that a picture was generated rather than photographed or painted.
  let luma = luminance(colour);
  let extremity = abs(luma - 0.5) * 2.0;
  colour = mix(colour, vec3f(luma), extremity * extremity * 0.22);
  colour = clamp(colour, vec3f(0.05), vec3f(0.96));
  return vec4f(colour, 1.0);
}
