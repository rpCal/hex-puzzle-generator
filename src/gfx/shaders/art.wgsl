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
fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

// Domain-warped fbm: smooth, organic, and rich in the mid-frequency detail that makes a jigsaw
// solvable. Flat regions are the enemy of a good puzzle.
fn style_nebula(uv: vec2f, seed: f32) -> vec3f {
  let p = uv * 3.0 + vec2f(seed * 13.7, seed * 7.1);
  let q = vec2f(fbm(p, 5), fbm(p + vec2f(5.2, 1.3), 5));
  let r = vec2f(fbm(p + 4.0 * q + vec2f(1.7, 9.2), 5), fbm(p + 4.0 * q + vec2f(8.3, 2.8), 5));
  let f = fbm(p + 4.0 * r, 5);
  return palette(
    f + 0.15 * r.x,
    vec3f(0.52, 0.44, 0.55),
    vec3f(0.45, 0.42, 0.40),
    vec3f(1.0, 0.95, 0.85),
    vec3f(0.0, 0.22, 0.52),
  );
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
  let base = palette(
    tone,
    vec3f(0.48, 0.40, 0.52),
    vec3f(0.42, 0.44, 0.38),
    vec3f(0.9, 1.0, 1.1),
    vec3f(0.15, 0.45, 0.75),
  );
  return base * mix(0.35, 1.0, border);
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
  let bands = 0.5 + 0.5 * sin(accum * 9.0 + seed);
  return palette(
    accum * 0.5 + bands * 0.2,
    vec3f(0.42, 0.46, 0.55),
    vec3f(0.44, 0.40, 0.36),
    vec3f(1.1, 0.85, 0.7),
    vec3f(0.35, 0.08, 0.62),
  );
}

// Concentric interference, with enough warp that no two pieces look alike.
fn style_bloom(uv: vec2f, seed: f32) -> vec3f {
  let centre = vec2f(0.5) + vec2f(hash21(vec2f(seed, 1.0)), hash21(vec2f(seed, 2.0))) * 0.3 - 0.15;
  let d = uv - centre;
  let warp = fbm(uv * 4.0 + seed, 4);
  let radius = length(d) * (1.0 + warp * 0.55);
  let angle = atan2(d.y, d.x);
  let rings = 0.5 + 0.5 * sin(radius * 34.0 + angle * 5.0 + warp * 6.0);
  return palette(
    rings * 0.45 + radius,
    vec3f(0.50, 0.42, 0.44),
    vec3f(0.40, 0.42, 0.46),
    vec3f(0.85, 1.0, 0.95),
    vec3f(0.62, 0.28, 0.05),
  );
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let style = i32(art.config.x + 0.5);
  let seed = art.config.y;
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
  // which would make a piece indistinguishable from the board behind it.
  colour = clamp((colour - 0.5) * 1.18 + 0.52, vec3f(0.04), vec3f(1.0));
  return vec4f(colour, 1.0);
}
