#include "./common.wgsl"

// The main pass. One indexed draw covers every piece on the board: each vertex carries the id of
// the piece it belongs to and looks that piece's transform up in a storage buffer, so pieces with
// different silhouettes still share a single draw call.
//
// Instance 0 is the drop shadow and instance 1 the piece itself, which gets the shadow for the
// price of one extra instance rather than a second pass.

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> pieces: array<PieceData>;
@group(0) @binding(2) var art_texture: texture_2d<f32>;
@group(0) @binding(3) var art_sampler: sampler;

struct VertexOut {
  @builtin(position) clip: vec4f,
  // 0 on the outline, 1 at the inner ring. An interpolated stand-in for distance-to-boundary:
  // exact where it matters (the silhouette) and monotone inward, which is all the bevel needs.
  @location(0) edge: f32,
  @location(1) uv: vec2f,
  @location(2) tint: vec4f,
  @location(3) misc: vec4f,
  @location(4) @interpolate(flat) piece_id: u32,
  @location(5) @interpolate(flat) is_shadow: u32,
}

const SHADOW_OFFSET = vec2f(0.10, 0.16);
const SHADOW_HELD_SCALE = 2.6;

@vertex
fn vs(
  @location(0) local: vec2f,
  @location(1) edge: f32,
  @location(2) piece_id_f: f32,
  @builtin(instance_index) instance: u32,
) -> VertexOut {
  let id = u32(piece_id_f + 0.5);
  let d = pieces[id];
  let held = d.misc.y;

  var world = piece_apply(d, local);

  var out: VertexOut;
  out.is_shadow = select(0u, 1u, instance == 0u);

  if (instance == 0u) {
    // Offset in world units, scaled by the hex radius encoded in the board size, and thrown
    // further when the piece is lifted. Depth is nudged back so the piece always wins.
    let lift = 1.0 + held * SHADOW_HELD_SCALE;
    let radius = globals.board.z * 0.02;
    world += SHADOW_OFFSET * radius * lift;
  }

  out.clip = vec4f(cam_apply(globals, world), d.misc.x + select(0.0, 0.002, instance == 0u), 1.0);
  out.edge = edge;
  // The piece's window into the source image: its normalised solved centre plus the local offset
  // measured in board units. Independent of where the piece currently *is*, which is what makes a
  // scattered piece still show its own patch of the picture.
  out.uv = d.offset.zw + local / globals.board.zw;
  out.tint = d.tint;
  out.misc = d.misc;
  out.piece_id = id;
  return out;
}

struct FragmentOut {
  @location(0) color: vec4f,
  @location(1) id: u32,
}

const BEVEL_LIGHT = vec3f(-0.55, -0.72, 0.42);

@fragment
fn fs(in: VertexOut) -> FragmentOut {
  var out: FragmentOut;

  // Analytic anti-aliasing. `edge / fwidth(edge)` converts the interpolated attribute into an
  // approximate distance in pixels, which is exactly what a coverage term needs. This is why the
  // renderer needs no MSAA -- and it must not have any, because the r32uint picking attachment
  // cannot be multisampled and resolved.
  // Every derivative this shader needs is taken up front, before any `discard`. WGSL requires
  // dpdx/dpdy/fwidth to be reached in uniform control flow, and a discard makes everything after
  // it non-uniform -- a rule the compiler enforces, and one worth knowing before writing the
  // obvious "early out then shade" version.
  let width = max(fwidth(in.edge), 1e-6);
  let grad = vec2f(dpdx(in.edge), dpdy(in.edge));
  // textureSample takes implicit derivatives too, so it is subject to the same rule.
  let albedo = textureSample(art_texture, art_sampler, in.uv).rgb;

  let coverage = clamp(in.edge / width + 0.5, 0.0, 1.0);
  if (coverage <= 0.002) {
    discard;
  }

  if (in.is_shadow == 1u) {
    let softness = clamp(in.edge * 3.0, 0.0, 1.0);
    out.color = vec4f(0.0, 0.0, 0.0, coverage * softness * 0.55 * in.tint.a);
    out.id = 0u;
    return out;
  }

  // A surface normal out of the same scalar field: the gradient gives the slope of the bevel and
  // the constant z sets how steep it reads. No extra data, no extra passes.
  let slope = 1.0 - smoothstep(0.0, 0.85, in.edge);
  let normal = normalize(vec3f(-grad * 220.0 * slope, 1.0));
  let lambert = clamp(dot(normal, normalize(BEVEL_LIGHT)), 0.0, 1.0);

  // Cardboard-ish shading: a lit chamfer on the near side, a contact shadow just inside the cut,
  // and a thin rim so pieces stay legible against one another when the picture is dark.
  let chamfer = 1.0 + lambert * 0.55 * slope;
  let inner_shadow = mix(0.62, 1.0, smoothstep(0.0, 0.30, in.edge));
  let rim = pow(1.0 - clamp(in.edge * 5.0, 0.0, 1.0), 3.0);

  var colour = albedo * chamfer * inner_shadow;
  colour += vec3f(0.55, 0.62, 0.80) * rim * 0.16;

  // Held pieces lift toward the viewer: brighter, warmer rim.
  let held = in.misc.y;
  colour = mix(colour, colour * 1.14 + vec3f(0.10, 0.09, 0.06) * rim, held);

  // Highlight pulse, used by the hint assist and the snap flash.
  let highlight = in.misc.z;
  colour += in.tint.rgb * highlight;

  // Reveal: as the board completes, the cut shading fades out and the picture becomes seamless.
  let reveal = globals.time.z;
  colour = mix(albedo, colour, reveal);

  out.color = vec4f(colour, coverage * in.tint.a);
  // +1 so that zero means "no piece here" in the picking target.
  out.id = in.piece_id + 1u;
  return out;
}
