/**
 * end-screen.ts — Pure result-screen logic: percentage, letter rating,
 * rating color, and corresponding singer image.
 *
 * Deliberately has no DOM access, matching the existing pattern in
 * singer.ts (getSingerState is pure; main.ts owns all DOM writes). This
 * keeps the rating math testable in isolation and keeps main.ts as the only
 * place that touches the document.
 *
 * ─── Max score definition ────────────────────────────────────────────────────
 * "Max possible score" = (total cue count across all phrases) × 300, where
 * 300 is POINTS.Perfect in scoring.ts (i.e. every single cue rated Perfect).
 * This does NOT include any combo multiplier — scoring.ts's applyRating()
 * does not currently implement one despite game-design.md mentioning "a
 * combo multiplier applies to Perfect and Great." That's a pre-existing
 * doc/code mismatch, not something introduced here; if a multiplier is added
 * to scoring.ts later, getMaxScore()'s formula below must be updated to match
 * or the percentage/letter-rating math will silently drift from reality.
 *
 * Total cue count is not tracked anywhere today (PhraseRow[] only exists
 * inside main.ts after buildSchedule() runs), so main.ts must pass it in
 * explicitly — see getMaxScore()'s parameter.
 */

import type { RatingType, ScoreState, SingerState } from "../types";

// ─── Points (mirrors scoring.ts; duplicated rather than imported to keep
// this module fully decoupled from scoring.ts's internals — only POINTS.Perfect
// is needed here, and re-deriving max score from a ScoreManager instance would
// require holding a live reference. If POINTS ever changes in scoring.ts,
// update PERFECT_POINTS here to match.) ─────────────────────────────────────
const PERFECT_POINTS = 300;

// ─── Letter rating thresholds ─────────────────────────────────────────────────
//
// Percentages are inclusive lower bounds, checked top to bottom — first
// match wins. Values and colors as specified by the project owner:
//   S — score >= 95% of max — gold
//   A — score >= 85% of max — blue
//   B — score >= 70% of max — green
//   C — score >= 50% of max — purple
//   D — score <  50% of max — white
export type LetterRating = "S" | "A" | "B" | "C" | "D";

export const RATING_LETTER_COLORS: Record<LetterRating, string> = {
  S: "#d4af37", // gold
  A: "#5b9cf6", // blue (matches RATING_COLORS.Perfect in rating.ts)
  B: "#4ade80", // green (matches RATING_COLORS.Great in rating.ts)
  C: "#c084fc", // purple (matches RATING_COLORS.Bad in rating.ts)
  D: "#ffffff", // white
};

// Singer image filename (relative to /src/assets/singer/) for each letter
// rating, as specified by the project owner.
const RATING_SINGER_IMAGE: Record<LetterRating, string> = {
  S: "singer_happy.png",
  A: "singer_singing.png",
  B: "singer_idle.png",
  C: "singer_sad.png",
  D: "singer_angry.png",
};

// Corresponding SingerState per letter, for callers that want the state
// label rather than (or in addition to) the raw filename — e.g. if a future
// change wants to reuse singer.ts's existing state→behavior conventions.
const RATING_SINGER_STATE: Record<LetterRating, SingerState> = {
  S: "happy",
  A: "singing",
  B: "idle",
  C: "sad",
  D: "angry",
};

// ─── getMaxScore ──────────────────────────────────────────────────────────────

/**
 * Maximum possible score for a song: every cue rated Perfect.
 *
 * @param totalCueCount — Sum of cues across all phrases (e.g.
 *                        phraseRows.reduce((n, r) => n + r.cues.length, 0)).
 */
export function getMaxScore(totalCueCount: number): number {
  return totalCueCount * PERFECT_POINTS;
}

// ─── getScorePercentage ───────────────────────────────────────────────────────

/**
 * Final score as a percentage of max possible score, 0–100.
 *
 * Guards against totalCueCount === 0 (e.g. a song with no eligible cues,
 * or this being called before buildSchedule() ever ran) by returning 0
 * rather than dividing by zero / producing NaN.
 */
export function getScorePercentage(score: number, totalCueCount: number): number {
  const maxScore = getMaxScore(totalCueCount);
  if (maxScore <= 0) return 0;
  return (score / maxScore) * 100;
}

// ─── getLetterRating ──────────────────────────────────────────────────────────

/**
 * Map a score percentage (0–100) to a letter rating.
 * Thresholds are inclusive lower bounds, checked highest first.
 */
export function getLetterRating(percentage: number): LetterRating {
  if (percentage >= 95) return "S";
  if (percentage >= 85) return "A";
  if (percentage >= 70) return "B";
  if (percentage >= 50) return "C";
  return "D";
}

// ─── getRatingColor ───────────────────────────────────────────────────────────

export function getRatingColor(letter: LetterRating): string {
  return RATING_LETTER_COLORS[letter];
}

// ─── getSingerImageForLetter ──────────────────────────────────────────────────

/**
 * Singer image filename (e.g. "singer_happy.png") for a given letter rating.
 * Caller (main.ts) is responsible for resolving this against the actual
 * import path / asset URL, same as singer-animation.ts does for its own
 * imports — this module only returns the filename, not a resolved module.
 */
export function getSingerImageForLetter(letter: LetterRating): string {
  return RATING_SINGER_IMAGE[letter];
}

/**
 * SingerState equivalent of a letter rating, for callers that prefer the
 * state label over the raw filename.
 */
export function getSingerStateForLetter(letter: LetterRating): SingerState {
  return RATING_SINGER_STATE[letter];
}

// ─── EndScreenData ────────────────────────────────────────────────────────────

/**
 * Everything the end-screen DOM rendering code needs, computed once from
 * the final ScoreState and the song's total cue count.
 */
export interface EndScreenData {
  score: number;
  maxScore: number;
  percentage: number;       // 0–100, rounded to 1 decimal place for display
  letter: LetterRating;
  letterColor: string;
  maxCombo: number;
  counts: Record<RatingType, number>;
  singerImageFile: string;  // e.g. "singer_happy.png"
}

/**
 * Compute the full end-screen data set from final score state.
 *
 * @param state         — Final ScoreState snapshot (score, combo, counts).
 * @param totalCueCount — Total cues across the song, for max-score math.
 */
export function computeEndScreenData(
  state: ScoreState,
  totalCueCount: number
): EndScreenData {
  const maxScore = getMaxScore(totalCueCount);
  const percentage = getScorePercentage(state.score, totalCueCount);
  const letter = getLetterRating(percentage);

  return {
    score: state.score,
    maxScore,
    percentage: Math.round(percentage * 10) / 10,
    letter,
    letterColor: getRatingColor(letter),
    maxCombo: state.maxCombo,
    counts: { ...state.counts },
    singerImageFile: getSingerImageForLetter(letter),
  };
}
