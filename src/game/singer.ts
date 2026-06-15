/**
 * singer.ts — Singer character state machine.
 *
 * Exports getSingerState(), a pure function that maps the current ScoreState
 * and most recent rating to one of four SingerState strings. Has no DOM access
 * or side effects. The caller (main.ts) applies the state to the <img> src.
 *
 * State priority (checked top to bottom — first match wins):
 *
 *   idle    — lastRating is null (no cue has resolved yet since game start).
 *             The singer stands in a neutral pose before the first input.
 *
 *   happy   — lastRating === "Perfect", OR combo >= 10.
 *             A Perfect hit triggers happy immediately regardless of combo.
 *             A sustained combo of 10+ keeps the singer happy even on Great/Good.
 *
 *   sad     — lastRating === "Miss" or "Bad", OR combo === 0 (after first cue).
 *             Checked before singing so a Miss that drops combo to 0 shows sad.
 *
 *   singing — combo between 1 and 9 inclusive, no special condition met.
 *             Also used as the default for combo 1–4 where the plan is silent.
 *
 * The "after first cue" guard for sad: once lastRating is non-null we know the
 * song has started and combo = 0 means the player just missed or got a Bad.
 */

import type { RatingType, ScoreState, SingerState } from "../types";

/**
 * Derive the singer's visual state from the current score snapshot.
 *
 * @param state      — The current ScoreState from ScoreManager.
 * @param lastRating — The most recently resolved rating, or null if no cue
 *                     has resolved yet (pre-first-cue, i.e. game just started).
 * @returns          — One of "idle" | "happy" | "singing" | "sad".
 */
export function getSingerState(
  state: ScoreState,
  lastRating: RatingType | null
): SingerState {
  // ── idle: before the first cue resolves ───────────────────────────────────
  // lastRating is null from game start until the first cue is resolved either
  // by a player press or a miss timeout. During this window the singer holds
  // the idle pose regardless of combo (which starts at 0).
  if (lastRating === null) {
    return "idle";
  }

  // ── happy: Perfect hit or sustained high combo ─────────────────────────────
  // A Perfect hit fires happy immediately. Combo >= 10 keeps the singer happy
  // even if the last individual rating was Great or Good.
  if (lastRating === "Perfect" || state.combo >= 10) {
    return "happy";
  }

  // ── sad: Miss / Bad hit, or combo dropped to zero ─────────────────────────
  // Checked before "singing" so that a Miss that resets combo to 0 shows sad
  // rather than falling through to singing. lastRating !== null is guaranteed
  // at this point (the idle guard above already returned).
  if (lastRating === "Miss" || lastRating === "Bad" || state.combo === 0) {
    return "sad";
  }

  // ── singing: combo 1–9, no special condition ──────────────────────────────
  // The design doc specifies singing for combo >= 5 and < 10. Combo 1–4 is
  // not explicitly specified; "singing" is returned here as the most natural
  // positive-but-not-excited state.
  return "singing";
}
