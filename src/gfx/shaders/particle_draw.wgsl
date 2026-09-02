#include "./common.wgsl"
#include "./particle_common.wgsl"

// One instanced quad per particle, additive, no texture. Reads the same buffer the simulation
// writes, but read-only -- which is why this lives in its own module.

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> globals: Globals;

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) offset: vec2f,
  @location(1) colour: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
  );
  let corner = corners[vertex];
  let p = particles[instance];

  var out: VertexOut;
  let lifetime = p.timing.y;
  if (lifetime <= 0.0) {
    // Push a dead particle behind the near plane. Cheaper than any per-fragment test, and it
    // costs no fill at all.
    out.clip = vec4f(0.0, 0.0, 2.0, 1.0);
    out.offset = vec2f(0.0);
    out.colour = vec4f(0.0);
    return out;
  }

  let t = clamp(p.timing.x / lifetime, 0.0, 1.0);
  // Sparks flare then shrink; the squared falloff makes the tail read as quick rather than mushy.
  let size = p.look.w * (0.35 + 1.05 * (1.0 - t) * (1.0 - t));
  let world = p.motion.xy + corner * size;

  out.clip = vec4f(cam_apply(globals, world), 0.0, 1.0);
  out.offset = corner;
  out.colour = vec4f(p.look.rgb, (1.0 - t) * (1.0 - t));
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  // Round, soft-edged sprite derived from the quad's own local coordinates.
  let d = dot(in.offset, in.offset);
  let falloff = clamp(1.0 - d, 0.0, 1.0);
  let intensity = falloff * falloff * in.colour.a;
  return vec4f(in.colour.rgb * intensity * 2.2, intensity);
}
