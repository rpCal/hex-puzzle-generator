import { Difficulty, DIFFICULTY_COUNT, Mode, MODE_COUNT } from '../rules/presets.ts';

/**
 * The shareable puzzle identifier.
 *
 * A board is fully described by `(image, seed, rings, mode, difficulty)`, and the cut is a pure
 * function of those. So a link is not a pointer to a stored puzzle — it *is* the puzzle. Nothing is
 * uploaded, nothing is stored server-side, and two people opening the same link get boards that
 * agree edge for edge.
 *
 * Packed into nine bytes, which is exactly twelve base64url characters with no padding:
 *
 *   byte 0   vvmmmddd   version (2) | mode (3) | difficulty (3)
 *   byte 1   rrrrrrrr   rings, 0..255 (only 0..31 are meaningful)
 *   bytes 2-5           seed, big-endian u32
 *   bytes 6-8           image id, big-endian u24
 *
 * `imageId` is an index into the bundled art for built-in images, or the low 24 bits of a
 * user-supplied image's content hash. In the latter case the recipient is prompted for the same
 * file: the hash travels, the picture never does.
 */

export const CODEC_VERSION = 1;
export const ENCODED_LENGTH = 12;

export interface PuzzleId {
  readonly version: number;
  readonly mode: Mode;
  readonly difficulty: Difficulty;
  /** Board rings. Usually implied by difficulty, but carried so a custom size still shares. */
  readonly rings: number;
  /** 32-bit cut seed. */
  readonly seed: number;
  /** 24-bit image identifier. */
  readonly imageId: number;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODE_TABLE = ((): Int16Array => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i++) table[B64URL.charCodeAt(i)] = i;
  return table;
})();

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out +=
      B64URL[(triple >> 18) & 63]! +
      B64URL[(triple >> 12) & 63]! +
      B64URL[(triple >> 6) & 63]! +
      B64URL[triple & 63]!;
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const out = new Uint8Array((text.length / 4) * 3);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let triple = 0;
    for (let k = 0; k < 4; k++) {
      const code = text.charCodeAt(i + k);
      const v = code < 128 ? (DECODE_TABLE[code] ?? -1) : -1;
      if (v < 0) return null;
      triple = (triple << 6) | v;
    }
    out[o++] = (triple >> 16) & 0xff;
    out[o++] = (triple >> 8) & 0xff;
    out[o++] = triple & 0xff;
  }
  return out;
}

export function encodePuzzleId(id: PuzzleId): string {
  const bytes = new Uint8Array(9);
  bytes[0] =
    (((id.version & 0x3) << 6) | ((id.mode & 0x7) << 3) | (id.difficulty & 0x7)) & 0xff;
  bytes[1] = id.rings & 0xff;
  bytes[2] = (id.seed >>> 24) & 0xff;
  bytes[3] = (id.seed >>> 16) & 0xff;
  bytes[4] = (id.seed >>> 8) & 0xff;
  bytes[5] = id.seed & 0xff;
  bytes[6] = (id.imageId >>> 16) & 0xff;
  bytes[7] = (id.imageId >>> 8) & 0xff;
  bytes[8] = id.imageId & 0xff;
  return toBase64Url(bytes);
}

/**
 * Decode, or `null` for anything malformed.
 *
 * Returns null rather than throwing, and rather than returning a partly-garbage board: a mistyped
 * link should drop the player into the default puzzle with a notice, not into a board with 200
 * rings or a mode that does not exist. Every field is range-checked, which is what makes the packed
 * format safe to accept from a URL.
 */
export function decodePuzzleId(text: string): PuzzleId | null {
  if (text.length !== ENCODED_LENGTH) return null;
  const bytes = fromBase64Url(text);
  if (bytes === null || bytes.length !== 9) return null;

  const head = bytes[0] as number;
  const version = (head >> 6) & 0x3;
  const mode = (head >> 3) & 0x7;
  const difficulty = head & 0x7;
  const rings = bytes[1] as number;

  if (version !== CODEC_VERSION) return null;
  if (mode >= MODE_COUNT) return null;
  if (difficulty >= DIFFICULTY_COUNT) return null;
  if (rings < 1 || rings > 31) return null;

  const seed =
    (((bytes[2] as number) << 24) |
      ((bytes[3] as number) << 16) |
      ((bytes[4] as number) << 8) |
      (bytes[5] as number)) >>>
    0;
  const imageId =
    (((bytes[6] as number) << 16) | ((bytes[7] as number) << 8) | (bytes[8] as number)) >>> 0;

  return { version, mode: mode as Mode, difficulty: difficulty as Difficulty, rings, seed, imageId };
}

const HASH_PREFIX = '#p=';

/** Build the shareable URL fragment. */
export function toUrlHash(id: PuzzleId): string {
  return HASH_PREFIX + encodePuzzleId(id);
}

/**
 * Read a puzzle id out of a URL, a bare fragment, or a bare code.
 *
 * Lenient about the wrapper because people paste links in every possible state of mangling; strict
 * about the payload, which `decodePuzzleId` enforces.
 */
export function fromUrlHash(input: string): PuzzleId | null {
  const hashIndex = input.lastIndexOf(HASH_PREFIX);
  const code = hashIndex >= 0 ? input.slice(hashIndex + HASH_PREFIX.length) : input.replace(/^#/, '');
  return decodePuzzleId(code.trim());
}

/** Normalise a possibly out-of-range value into a valid, encodable puzzle id. */
export function clampPuzzleId(id: Partial<PuzzleId>): PuzzleId {
  const mode = id.mode ?? Mode.Classic;
  const difficulty = id.difficulty ?? Difficulty.Standard;
  return {
    version: CODEC_VERSION,
    mode: mode >= 0 && mode < MODE_COUNT ? mode : Mode.Classic,
    difficulty:
      difficulty >= 0 && difficulty < DIFFICULTY_COUNT ? difficulty : Difficulty.Standard,
    rings: Math.min(31, Math.max(1, Math.floor(id.rings ?? 5))),
    seed: (id.seed ?? 0) >>> 0,
    imageId: (id.imageId ?? 0) & 0xffffff,
  };
}
