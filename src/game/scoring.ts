/**
 * scoring.ts — Hit detection, rating calculation, score and combo state.
 *
 * Exported surface:
 *   ScoreManager — class with handleInput() and applyRating().
 *
 * Design notes:
 *   - ScoreManager is instantiated once in main.ts and passed no DOM references.
 *     It communicates outward exclusively via the 'scoreupdate' CustomEvent so
 *     this module has no import-time dependency on the DOM or TextAlive API.
 *   - handleInput() receives lastRenderedPosition (not player.timer.position
 *     directly) so timing judgements are consistent with the playhead the
 *     player sees on screen. Both are driven by the same value in main.ts.
 *   - applyRating() dispatches a snapshot of ScoreState, not a reference to
 *     the live state object, so listeners always read the value at dispatch time.
 *
 * Chunk 8 addition:
 *   - lastRating field tracks the most recently resolved RatingType (or null
 *     before the first cue resolves). Included in the scoreupdate event detail
 *     so main.ts can pass it to getSingerState() without importing scoring.ts
 *     internals.
 */

import { resolveCue } from "../ui/rating";
import type { Direction, PhraseRow, RatingType, ScoreState } from "../types";

// ─── Timing windows ───────────────────────────────────────────────────────────
// These must stay in sync with HIT_WINDOW_MS in arrows.ts (the miss deadline).
// All values are the maximum absolute delta (ms) from the beat timestamp that
// still qualifies for that rating tier.

const WINDOW_PERFECT = 45;
const WINDOW_GREAT   = 90;
const WINDOW_GOOD    = 120;
const WINDOW_BAD     = 150; // must equal HIT_WINDOW_MS in arrows.ts

// ─── Point values ─────────────────────────────────────────────────────────────

const POINTS: Record<RatingType, number> = {
  Perfect: 300,
  Great:   200,
  Good:    100,
  Bad:     50,
  Miss:    0,
};

// ─── ScoreManager ─────────────────────────────────────────────────────────────

export class ScoreManager {
  // The complete scoring state. Read externally via the 'scoreupdate' event;
  // never mutated outside this class.
  state: ScoreState = {
    score:    0,
    combo:    0,
    maxCombo: 0,
    counts: {
      Perfect: 0,
      Great:   0,
      Good:    0,
      Bad:     0,
      Miss:    0,
    },
  };

  // ── Chunk 8: lastRating ──────────────────────────────────────────────────
  // Tracks the most recently resolved rating so getSingerState() in singer.ts
  // can differentiate "idle before first cue" (null) from "combo just reset to
  // zero after a Miss" (non-null). Set to null at game start and after reset().
  lastRating: RatingType | null = null;

  // ── reset ────────────────────────────────────────────────────────────────
  // Called from main.ts's onVideoReady whenever a song is (re)loaded, so a
  // fresh start or "Play Again" doesn't carry over the previous run's score.
  reset(): void {
    this.state = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      counts: { Perfect: 0, Great: 0, Good: 0, Bad: 0, Miss: 0 },
    };
    this.lastRating = null;
  }

  // ── handleInput ─────────────────────────────────────────────────────────────

  /**
   * Process a directional press from the player.
   *
   * Finds the first unresolved cue in the active phrase whose beatTime falls
   * within the hit window of `now`. If the direction matches, rates the hit
   * and resolves the cue. If no matching cue exists, the press is ignored
   * (stray press — no penalty).
   *
   * Wrong-direction presses are also ignored: the miss timeout on the cue
   * will fire naturally when the window expires. This matches the design doc.
   *
   * @param direction  — The direction the player pressed.
   * @param now        — Current playback position in ms. Pass lastRenderedPosition
   *                     from main.ts, not player.timer.position directly, so the
   *                     timing judgement matches what the player sees on screen.
   * @param activeRow  — The currently active PhraseRow.
   */
  handleInput(direction: Direction, now: number, activeRow: PhraseRow): void {
    // Find the first unresolved cue within the hit window.
    const cue = activeRow.cues.find(
      (c) =>
        !c.resolved &&
        Math.abs(now - c.beatTime) <= WINDOW_BAD
    );

    // No cue in window — stray press, ignore silently.
    if (!cue) return;

    // Wrong direction — ignore. The miss timeout handles expiry.
    if (cue.direction !== direction) return;

    // ── Rate the hit ────────────────────────────────────────────────────────
    const delta = Math.abs(now - cue.beatTime);
    let rating: RatingType;

    if      (delta <= WINDOW_PERFECT) rating = "Perfect";
    else if (delta <= WINDOW_GREAT)   rating = "Great";
    else if (delta <= WINDOW_GOOD)    rating = "Good";
    else                              rating = "Bad";

    // Cancel the miss timeout — the cue has been handled by the player.
    if (cue.timeoutId !== null) {
      clearTimeout(cue.timeoutId);
      cue.timeoutId = null;
    }

    // Display the rating word and schedule DOM removal.
    resolveCue(cue, rating);

    // Update score state and dispatch the scoreupdate event.
    this.applyRating(rating);
  }

  // ── applyRating ─────────────────────────────────────────────────────────────

  /**
   * Update score state for a resolved cue and dispatch a 'scoreupdate' event.
   *
   * Also called externally by the miss timeout path — resolveCue() handles the
   * visual, but the score state update for a Miss comes through here so all
   * rating outcomes go through the same accounting path.
   *
   * Dispatches a deep snapshot of the state so event listeners always read the
   * value at dispatch time, not a reference to the mutable live object.
   *
   * @param rating — The rating to apply.
   */
  applyRating(rating: RatingType): void {
    const s = this.state;

    // ── Points ──────────────────────────────────────────────────────────────
    s.score += POINTS[rating];

    // ── Combo ───────────────────────────────────────────────────────────────
    if (rating === "Bad" || rating === "Miss") {
      s.combo = 0;
    } else {
      s.combo += 1;
    }

    if (s.combo > s.maxCombo) {
      s.maxCombo = s.combo;
    }

    // ── Count ───────────────────────────────────────────────────────────────
    s.counts[rating] += 1;

    // ── Chunk 8: track last rating ───────────────────────────────────────────
    // Updated here (after combo is recalculated) so getSingerState() in main.ts
    // always sees both the updated combo and the triggering rating together.
    this.lastRating = rating;

    // ── Dispatch snapshot ───────────────────────────────────────────────────
    // Spread both the top-level state and the nested counts record so the
    // listener receives a plain object frozen at this moment, not a live ref.
    // Chunk 8: lastRating is included in the detail so main.ts can derive
    // singer state without accessing scoreManager internals directly.
    document.dispatchEvent(
      new CustomEvent("scoreupdate", {
        detail: {
          ...s,
          counts: { ...s.counts },
          lastRating: this.lastRating,   // Chunk 8 addition
        },
      })
    );
  }
}
