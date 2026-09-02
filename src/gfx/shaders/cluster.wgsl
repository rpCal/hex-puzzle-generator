#include "./common.wgsl"

// Expand cluster transforms into per-piece render data.
//
// Welded pieces sit at their exact solved positions relative to one another, so a cluster of any
// size is described by a single position and rotation. This kernel turns that into the flat
// PieceData array the vertex shader indexes. Dragging a 400-piece cluster therefore costs one small
// buffer write rather than four hundred, and the CPU never touches per-piece transforms at all.
//
// The arithmetic here mirrors Clusters.worldPosition in core exactly, which is what lets a GPU test
// compare this kernel's output against the CPU implementation float for float.

struct ClusterXform {
  // World position of the cluster's anchor piece.
  position: vec2f,
  // Solved-space centre of that anchor.
  anchor_solved: vec2f,
  rotation: f32,
  // Draw depth, already normalised to 0..1.
  depth: f32,
  alpha: f32,
  highlight: f32,
}

struct PieceStatic {
  // Solved centre (xy) and normalised solved position in the atlas (zw).
  solved: vec4f,
}

struct Uniforms {
  piece_count: u32,
  held_cluster: u32,
  _pad0: u32,
  _pad1: u32,
  tint: vec4f,
}

@group(0) @binding(0) var<storage, read> clusters: array<ClusterXform>;
@group(0) @binding(1) var<storage, read> piece_cluster: array<u32>;
@group(0) @binding(2) var<storage, read> piece_static: array<PieceStatic>;
@group(0) @binding(3) var<storage, read_write> out_pieces: array<PieceData>;
@group(0) @binding(4) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= uniforms.piece_count) {
    return;
  }

  let cluster_index = piece_cluster[index];
  let c = clusters[cluster_index];
  let s = piece_static[index];

  let local = s.solved.xy - c.anchor_solved;
  let world = c.position + rot2(local, c.rotation);

  let cs = cos(c.rotation);
  let sn = sin(c.rotation);

  var d: PieceData;
  d.xform = vec4f(cs, sn, -sn, cs);
  d.offset = vec4f(world, s.solved.zw);
  d.tint = vec4f(uniforms.tint.rgb, c.alpha);
  d.misc = vec4f(
    c.depth,
    select(0.0, 1.0, cluster_index == uniforms.held_cluster),
    c.highlight,
    0.0,
  );
  out_pieces[index] = d;
}
