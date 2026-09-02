/**
 * Par times and star ratings.
 *
 * The curve is deliberately super-linear. Solving time is not proportional to piece count: doubling
 * the pieces both doubles the placements *and* roughly doubles the number of candidates you scan
 * for each one. The quadratic term models that search cost; without it, a 1000-piece board would
 * carry a par a strong player could not touch and every rating would read zero.
 */

const BASE_SECONDS = 8;
const PER_PIECE_SECONDS = 1.6;
const SEARCH_COST = 0.0008;

/** Par time in seconds for a board of `pieces` pieces. */
export function parSeconds(pieces: number): number {
  const n = Math.max(1, pieces);
  return BASE_SECONDS + PER_PIECE_SECONDS * n + SEARCH_COST * n * n;
}

/** Multipliers applied to par by mode, reflecting how much harder the mode makes the same board. */
export const MODE_PAR_MULTIPLIER = {
  classic: 1,
  zen: 1,
  /** Every piece needs its angle found as well as its place. */
  rotation: 1.45,
  /** No reference image to check against. */
  mirror: 1.3,
  /** Fading pieces punish deliberation. */
  blitz: 1.15,
} as const;

export type ParMultiplierKey = keyof typeof MODE_PAR_MULTIPLIER;

export function parFor(pieces: number, mode: ParMultiplierKey = 'classic'): number {
  return parSeconds(pieces) * MODE_PAR_MULTIPLIER[mode];
}

/** Star thresholds as fractions of par. */
export const STAR_THRESHOLDS = { three: 0.7, two: 1, one: 1.6 } as const;

/** Stars earned, 0 to 3. A time at or under 70% of par earns all three. */
export function starsFor(elapsedSeconds: number, par: number): number {
  if (!(elapsedSeconds >= 0) || !(par > 0)) return 0;
  const ratio = elapsedSeconds / par;
  if (ratio <= STAR_THRESHOLDS.three) return 3;
  if (ratio <= STAR_THRESHOLDS.two) return 2;
  if (ratio <= STAR_THRESHOLDS.one) return 1;
  return 0;
}

export interface RunScore {
  readonly elapsedSeconds: number;
  readonly par: number;
  readonly stars: number;
  /** 0..1, clamped. Purely for the completion bar. */
  readonly ratio: number;
  readonly underPar: boolean;
}

export function scoreRun(
  elapsedSeconds: number,
  pieces: number,
  mode: ParMultiplierKey = 'classic',
): RunScore {
  const par = parFor(pieces, mode);
  return {
    elapsedSeconds,
    par,
    stars: starsFor(elapsedSeconds, par),
    ratio: Math.min(1, Math.max(0, elapsedSeconds / par)),
    underPar: elapsedSeconds <= par,
  };
}

const pad2 = (v: number): string => v.toString().padStart(2, '0');

/** `m:ss` for the HUD, or `h:mm:ss` past an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
