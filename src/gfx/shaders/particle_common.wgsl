// Shared particle layout. Split out because the simulation needs `read_write` storage access and
// WGSL forbids that in a vertex stage -- so the sim and the draw have to be separate modules, and
// this is the piece they must agree on.

struct Particle {
  // position xy, velocity xy
  motion: vec4f,
  // rgb tint, size
  look: vec4f,
  // age, lifetime, drag, spin
  timing: vec4f,
}
