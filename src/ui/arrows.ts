/**
 * arrows.ts — Cue arming: set miss timeouts for all cues in a phrase row.
 *
 * Exported surface:
 *   armCues() — called whenever a phrase row becomes active. Sets a setTimeout
 *               for each unresolved cue so it auto-resolves as Miss if the
 *               player does not press the correct direction in time.
 *
 * Relationship to other modules:
 *   - Imports resolveCue() from rating.ts to fire the Miss resolution.
 *   - Called by main.ts from the phrase-advance logic (inside tick()) and once
 *     on initial load for the first active phrase.
 *   - scoring.ts calls clearTimeout(cue.timeoutId) on a successful hit so the
 *     miss does not double-fire after a player press.
 *
 * Known limitation (TODO Chunk 7):
 *   setTimeout runs in wall-clock time. If the player pauses mid-phrase, miss
 *   timeouts continue counting down and will fire while the song is paused.
 *   The correct fix is to cancel all armed timeouts on pause and re-arm them
 *   on resume with updated delays. This requires hooking into the player's
 *   onPause / onPlay callbacks, which will be wired in Chunk 7/8.
 */

import { resolveCue } from "./rating";
import type { PhraseRow, RatingType } from "../types";

// ─── Timing constants ─────────────────────────────────────────────────────────

/**
 * Half-width of the hit window in milliseconds.
 * A press is accepted up to HIT_WINDOW_MS after the beat timestamp.
 * Must match the Bad threshold in scoring.ts (Chunk 7) — keep in sync.
 */
const HIT_WINDOW_MS = 100;

/**
 * Extra buffer added to the miss deadline so the resolution fires slightly
 * after the window closes rather than exactly on it. This prevents the miss
 * from firing on the same frame as a late-but-valid press at the window edge.
 */
const MISS_BUFFER_MS = 5;

// ─── armCues ──────────────────────────────────────────────────────────────────

/**
 * Set miss timeouts for every unresolved cue in the given phrase row.
 *
 * For each cue the delay is calculated as:
 *   delay = (cue.beatTime - currentPosition) + HIT_WINDOW_MS + MISS_BUFFER_MS
 *
 * This means: wait until the beat has passed, plus the full hit window, plus
 * a small buffer — then fire Miss if the cue is still unresolved.
 *
 * Cues that are already resolved (e.g. the phrase was previously active and
 * partially played through) are skipped. Cues whose beat has already passed
 * the miss deadline at arm time are scheduled with a minimal delay (1ms) so
 * they fire on the next event-loop tick rather than immediately blocking.
 *
 * @param row             — The PhraseRow being activated.
 * @param currentPosition — player.timer.position at the moment of activation,
 *                          in milliseconds. Passed as a parameter rather than
 *                          reading from the player directly so this module
 *                          stays decoupled from the TextAlive API.
 */
export function armCues(
  row: PhraseRow,
  currentPosition: number,
  onMiss: (rating: RatingType) => void   // called after resolveCue on miss
): void {
  for (const cue of row.cues) {
    // Skip cues that were already resolved (e.g. on a re-activation after seek).
    if (cue.resolved) continue;

    // Calculate the wall-clock delay until the miss window closes.
    // If the beat has already passed (delay would be negative), use 1ms so
    // the miss fires on the next tick rather than with setTimeout(fn, negative).
    const delay = Math.max(
      1,
      (cue.beatTime - currentPosition) + HIT_WINDOW_MS + MISS_BUFFER_MS
    );

    // Store the timeout ID on the cue so scoring.ts can cancel it on a hit.
    cue.timeoutId = setTimeout(() => {
      resolveCue(cue, "Miss");
      // Notify the score manager so Miss affects combo and score.
      onMiss("Miss");
    }, delay) as unknown as number;
    // Note: in a browser, setTimeout returns a number. The `as unknown as number`
    // cast is needed because TypeScript in some configs infers the Node.js
    // overload (which returns NodeJS.Timeout) instead of the browser overload.
  }
}

// ─── disarmCues ───────────────────────────────────────────────────────────────

/**
 * Cancel all pending miss timeouts on a phrase row without resolving the cues.
 *
 * Called on pause so timeouts do not fire while the song is frozen.
 * The cues remain unresolved — armCues() will re-schedule them on resume.
 *
 * @param row — The currently active PhraseRow.
 */
export function disarmCues(row: PhraseRow): void {
  for (const cue of row.cues) {
    if (cue.timeoutId !== null) {
      clearTimeout(cue.timeoutId);
      cue.timeoutId = null;
    }
  }
}
