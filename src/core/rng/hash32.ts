/**
 * Counter-based hashing. There is no PRNG *state* here on purpose.
 *
 * The cut generator needs to ask "what are edge 900's jitter parameters?" without having generated
 * edges 0..899 first — pieces are built independently, in whatever order, and the print export walks
 * the board differently from the renderer. A stateful stream PRNG makes determinism depend on
 * iteration order, which is a bug waiting to happen. A hash makes it structural.
 *
 * The prior art this project draws from used `Math.sin(seed) * 10000` and took the fractional part.
 * That is not a PRNG: it has visible periodic structure, and `Math.sin` is not required to be
 * bit-identical across JS engines, so "same seed, same puzzle" would quietly stop being true across
 * browsers. Replaced with Chris Wellons' `lowbias32` finalizer, which is integer-only and therefore
 * exactly reproducible everywhere, including in WGSL if a shader ever needs the same values.
 */

/** Avalanche a 32-bit integer. Integer-only, so it is bit-identical on every platform. */
export function hash32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

const PHI = 0x9e3779b9 | 0;
const MIX_A = 0x85ebca6b | 0;
const MIX_B = 0xc2b2ae35 | 0;
const CHAN = 0x165667b1 | 0;

/**
 * Hash a `(seed, id, channel)` triple to a 32-bit integer.
 *
 * Mixed sequentially rather than XOR-folded: XOR-folding lets `(id, channel)` and `(channel, id)`
 * collide, which would correlate an edge's tab size with its jitter.
 */
export function hashAt(seed: number, id: number, channel: number): number {
  let h = hash32((seed >>> 0) ^ Math.imul((id | 0) + PHI, MIX_A));
  h = hash32(h ^ Math.imul((channel | 0) + CHAN, MIX_B));
  return h >>> 0;
}

/** Uniform in `[0, 1)` with 24 bits of mantissa. */
export function randomAt(seed: number, id: number, channel: number): number {
  return (hashAt(seed, id, channel) >>> 8) * 2 ** -24;
}

/** Uniform in `[min, max)`. */
export function uniformAt(
  seed: number,
  id: number,
  channel: number,
  min: number,
  max: number,
): number {
  return min + randomAt(seed, id, channel) * (max - min);
}

/** Uniform in `[-spread, spread)`. The jitter primitive used by the cut generator. */
export function jitterAt(seed: number, id: number, channel: number, spread: number): number {
  return uniformAt(seed, id, channel, -spread, spread);
}

/** A fair coin. */
export function boolAt(seed: number, id: number, channel: number): boolean {
  return (hashAt(seed, id, channel) & 1) === 1;
}

/** Uniform integer in `[0, n)`. `n <= 0` yields `0`. */
export function intAt(seed: number, id: number, channel: number, n: number): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.floor(randomAt(seed, id, channel) * n));
}

/**
 * A sequential stream, for the places where order genuinely does not matter and threading an id
 * would be noise — scattering pieces at board setup, particle spawn offsets. Still deterministic
 * given its own seed.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Next uniform in `[0, 1)`. */
  next(): number {
    this.#state = (this.#state + PHI) >>> 0;
    return (hash32(this.#state) >>> 8) * 2 ** -24;
  }

  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(n: number): number {
    return n <= 0 ? 0 : Math.min(n - 1, Math.floor(this.next() * n));
  }

  bool(): boolean {
    return this.next() < 0.5;
  }

  /** Fisher-Yates, in place. Returns the same array for chaining. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = items[i] as T;
      const b = items[j] as T;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }
}

/**
 * Hash a string to a 32-bit seed (FNV-1a). Used to turn a human-typed seed phrase, or an image's
 * content hash, into a numeric seed.
 */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h);
}
