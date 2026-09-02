// Shared declarations. Pulled in with `#include "./common.wgsl"`; the loader inlines each file
// once, so including this from several shaders does not redeclare anything.

struct Globals {
  // World -> clip, as a 2D affine transform. Rows (a, b, c, d) and (tx, ty).
  cam0: vec4f,
  // tx, ty, viewport width, viewport height
  cam1: vec4f,
  // board min x, min y, size x, size y -- lets the vertex shader derive atlas UVs on its own
  board: vec4f,
  // seconds, delta seconds, reveal fade (1 = cuts fully visible, 0 = seamless), pulse
  time: vec4f,
  // exposure, vignette, grain, bloom strength
  params: vec4f,
}

// One piece, as the renderer sees it. Written every frame by the cluster compute pass.
// 64 bytes; must stay in step with PIECE_DATA_STRIDE in core/cut/mesh.ts.
struct PieceData {
  // Rotation and scale, as (a, b, c, d).
  xform: vec4f,
  // World translation (xy) and normalised solved position (zw), the piece's origin in the atlas.
  offset: vec4f,
  // Tint rgb, alpha.
  tint: vec4f,
  // depth 0..1, held flag, highlight 0..1, spare
  misc: vec4f,
}

fn cam_apply(g: Globals, p: vec2f) -> vec2f {
  return vec2f(
    g.cam0.x * p.x + g.cam0.z * p.y + g.cam1.x,
    g.cam0.y * p.x + g.cam0.w * p.y + g.cam1.y,
  );
}

fn piece_apply(d: PieceData, p: vec2f) -> vec2f {
  return vec2f(
    d.xform.x * p.x + d.xform.z * p.y + d.offset.x,
    d.xform.y * p.x + d.xform.w * p.y + d.offset.y,
  );
}

fn rot2(p: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

// Integer hash, matching core/rng/hash32.ts exactly so CPU and GPU agree on any shared randomness.
fn hash32(x: u32) -> u32 {
  var h = x;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

fn rand_u(x: u32) -> f32 {
  return f32(hash32(x) >> 8u) * (1.0 / 16777216.0);
}

fn hash21(p: vec2f) -> f32 {
  let q = vec2u(bitcast<u32>(p.x), bitcast<u32>(p.y));
  return rand_u(hash32(q.x) ^ (q.y * 0x9e3779b9u));
}

// Value noise with smooth interpolation.
fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f, octaves: i32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var freq = p;
  for (var i = 0; i < octaves; i = i + 1) {
    sum += amp * noise2(freq);
    freq = freq * 2.03 + vec2f(17.3, 9.1);
    amp *= 0.5;
  }
  return sum;
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// A full-screen triangle. Cheaper than a quad and avoids the diagonal seam.
fn fullscreen_position(index: u32) -> vec4f {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(pts[index], 0.0, 1.0);
}

fn fullscreen_uv(index: u32) -> vec2f {
  var uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  return uvs[index];
}
