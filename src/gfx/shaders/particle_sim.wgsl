#include "./particle_common.wgsl"

// The snap burst, simulated.
//
// A silent, still snap reads as a bug rather than a reward, so every successful join sprays sparks
// from the seam that just closed, tinted from the picture itself. The CPU only ever appends spawn
// requests into free slots; everything else happens here.

struct SimUniforms {
  // delta seconds, capacity, gravity, spare
  config: vec4f,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> sim: SimUniforms;

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= u32(sim.config.y)) {
    return;
  }

  var p = particles[index];
  let lifetime = p.timing.y;
  if (lifetime <= 0.0) {
    return;
  }

  let dt = sim.config.x;
  let age = p.timing.x + dt;

  if (age >= lifetime) {
    // Retire in place rather than compacting the array. Stable slots mean the CPU can allocate
    // with a simple ring cursor and never has to read the buffer back.
    p.timing = vec4f(0.0, 0.0, p.timing.z, p.timing.w);
    p.look = vec4f(p.look.rgb, 0.0);
    particles[index] = p;
    return;
  }

  var velocity = p.motion.zw;
  velocity.y += sim.config.z * dt;
  velocity *= exp(-p.timing.z * dt);

  p.motion = vec4f(p.motion.xy + velocity * dt, velocity);
  p.timing.x = age;
  particles[index] = p;
}
