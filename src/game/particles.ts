import { Rng } from '@core/rng/hash32.ts';
import type { Vec2 } from '@core/math/vec2.ts';
import { PARTICLE_STRIDE_FLOATS } from '@gfx/renderer.ts';

/**
 * CPU side of the snap burst: allocate slots and fill in spawn data.
 *
 * The GPU never tells the CPU which slots are free, because reading a buffer back every frame would
 * cost far more than the occasional overwrite it avoids. Instead slots are handed out by a ring
 * cursor: with a capacity many times the largest burst, a slot is only ever reused long after its
 * particle has expired.
 */

export interface BurstOptions {
  readonly count?: number;
  /** Base speed in board units per second. */
  readonly speed?: number;
  readonly size?: number;
  readonly lifetime?: number;
  readonly drag?: number;
  /** Bias the spray along an axis — used to throw sparks along the seam that just closed. */
  readonly direction?: Vec2;
  readonly spread?: number;
}

export class ParticleSpawner {
  readonly capacity: number;
  #cursor = 0;
  #rng: Rng;

  constructor(capacity: number, seed = 0x5eed) {
    this.capacity = capacity;
    this.#rng = new Rng(seed);
  }

  get cursor(): number {
    return this.#cursor;
  }

  /**
   * Build the spawn data for one burst.
   *
   * Returns the slot the burst starts at and the packed floats; the caller hands both to
   * `Renderer.writeParticles`, which handles the wrap.
   */
  burst(
    origin: Vec2,
    colour: readonly [number, number, number],
    options: BurstOptions = {},
  ): { firstSlot: number; data: Float32Array } {
    const count = Math.min(options.count ?? 40, this.capacity);
    const speed = options.speed ?? 90;
    const size = options.size ?? 2.4;
    const lifetime = options.lifetime ?? 0.55;
    const drag = options.drag ?? 2.6;
    const spread = options.spread ?? Math.PI * 2;
    const baseAngle =
      options.direction === undefined
        ? 0
        : Math.atan2(options.direction.y, options.direction.x);

    const data = new Float32Array(count * PARTICLE_STRIDE_FLOATS);
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (this.#rng.next() - 0.5) * spread;
      // sqrt keeps the speed distribution even across the disc rather than clumping at the rim.
      const magnitude = speed * (0.35 + 0.65 * Math.sqrt(this.#rng.next()));
      const base = i * PARTICLE_STRIDE_FLOATS;

      // motion: position xy, velocity xy
      data[base + 0] = origin.x + (this.#rng.next() - 0.5) * size;
      data[base + 1] = origin.y + (this.#rng.next() - 0.5) * size;
      data[base + 2] = Math.cos(angle) * magnitude;
      data[base + 3] = Math.sin(angle) * magnitude;

      // look: rgb, size. A little per-particle brightness variance stops the burst reading flat.
      const shade = 0.75 + this.#rng.next() * 0.5;
      data[base + 4] = colour[0] * shade;
      data[base + 5] = colour[1] * shade;
      data[base + 6] = colour[2] * shade;
      data[base + 7] = size * (0.6 + this.#rng.next() * 0.8);

      // timing: age, lifetime, drag, spin
      data[base + 8] = 0;
      data[base + 9] = lifetime * (0.7 + this.#rng.next() * 0.6);
      data[base + 10] = drag;
      data[base + 11] = 0;
    }

    const firstSlot = this.#cursor;
    this.#cursor = (this.#cursor + count) % this.capacity;
    return { firstSlot, data };
  }

  /** Clear every slot. Used when a new board starts, so old sparks do not survive the transition. */
  clearAll(): { firstSlot: number; data: Float32Array } {
    this.#cursor = 0;
    return { firstSlot: 0, data: new Float32Array(this.capacity * PARTICLE_STRIDE_FLOATS) };
  }
}
