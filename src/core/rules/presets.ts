import type { TabParams } from '../cut/tab.ts';
import { pieceCount } from '../math/hex.ts';

/** Play modes. Numeric values are part of the shareable seed encoding and must never be reordered. */
export enum Mode {
  Classic = 0,
  Zen = 1,
  Rotation = 2,
  Mirror = 3,
  Blitz = 4,
}

export const MODE_COUNT = 5;

export interface ModeInfo {
  readonly id: Mode;
  readonly key: string;
  readonly name: string;
  readonly blurb: string;
  /** Pieces spawn rotated by a random multiple of 60 degrees and must be turned back. */
  readonly rotates: boolean;
  /** The reference image is withheld. */
  readonly hidesReference: boolean;
  /** A run is timed and scored. */
  readonly timed: boolean;
  /** Untouched pieces fade toward transparent over this many seconds. 0 disables. */
  readonly fadeSeconds: number;
}

export const MODES: readonly ModeInfo[] = [
  {
    id: Mode.Classic,
    key: 'classic',
    name: 'Classic',
    blurb: 'Timed. Beat par, earn stars.',
    rotates: false,
    hidesReference: false,
    timed: true,
    fadeSeconds: 0,
  },
  {
    id: Mode.Zen,
    key: 'zen',
    name: 'Zen',
    blurb: 'No clock, no score. Just the puzzle.',
    rotates: false,
    hidesReference: false,
    timed: false,
    fadeSeconds: 0,
  },
  {
    id: Mode.Rotation,
    key: 'rotation',
    name: 'Rotation',
    blurb: 'Pieces arrive turned. Match the angle as well as the place.',
    rotates: true,
    hidesReference: false,
    timed: true,
    fadeSeconds: 0,
  },
  {
    id: Mode.Mirror,
    key: 'mirror',
    name: 'Mirror',
    blurb: 'The reference is hidden. Solve by shape and colour alone.',
    rotates: false,
    hidesReference: true,
    timed: true,
    fadeSeconds: 0,
  },
  {
    id: Mode.Blitz,
    key: 'blitz',
    name: 'Blitz',
    blurb: 'Pieces fade if you leave them alone. Keep moving.',
    rotates: false,
    hidesReference: false,
    timed: true,
    fadeSeconds: 20,
  },
];

export function modeInfo(mode: Mode): ModeInfo {
  return MODES[mode] ?? (MODES[Mode.Classic] as ModeInfo);
}

/** Difficulty presets. Numeric values are part of the seed encoding; never reorder. */
export enum Difficulty {
  Sampler = 0,
  Casual = 1,
  Standard = 2,
  Hard = 3,
  Brutal = 4,
  Forge = 5,
}

export const DIFFICULTY_COUNT = 6;

export interface DifficultyInfo {
  readonly id: Difficulty;
  readonly key: string;
  readonly name: string;
  readonly rings: number;
  readonly pieces: number;
  readonly tab: TabParams;
}

/**
 * Tab size shrinks and jitter grows with difficulty. Both make the cut harder to read: small tabs
 * give less silhouette to match on, and high jitter means two pieces that look similar are less
 * likely to actually be neighbours.
 */
export const DIFFICULTIES: readonly DifficultyInfo[] = [
  { id: Difficulty.Sampler, key: 'sampler', name: 'Sampler', rings: 1, pieces: pieceCount(1), tab: { tabSize: 0.2, jitter: 0.04 } },
  { id: Difficulty.Casual, key: 'casual', name: 'Casual', rings: 3, pieces: pieceCount(3), tab: { tabSize: 0.18, jitter: 0.05 } },
  { id: Difficulty.Standard, key: 'standard', name: 'Standard', rings: 5, pieces: pieceCount(5), tab: { tabSize: 0.16, jitter: 0.06 } },
  { id: Difficulty.Hard, key: 'hard', name: 'Hard', rings: 8, pieces: pieceCount(8), tab: { tabSize: 0.14, jitter: 0.07 } },
  { id: Difficulty.Brutal, key: 'brutal', name: 'Brutal', rings: 12, pieces: pieceCount(12), tab: { tabSize: 0.12, jitter: 0.09 } },
  { id: Difficulty.Forge, key: 'forge', name: 'Forge', rings: 18, pieces: pieceCount(18), tab: { tabSize: 0.1, jitter: 0.11 } },
];

export function difficultyInfo(difficulty: Difficulty): DifficultyInfo {
  return DIFFICULTIES[difficulty] ?? (DIFFICULTIES[Difficulty.Standard] as DifficultyInfo);
}
