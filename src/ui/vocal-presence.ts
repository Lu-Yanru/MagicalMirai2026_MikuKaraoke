/**
 * vocal-presence.ts — Debounced vocal-presence detection.
 *
 * Replaces the old "is a lyric phrase active" signal (which was purely
 * IPhrase.startTime/endTime boundary checking) with a signal derived from the
 * song's actual audio content via TextAlive's getVocalAmplitude() API. This
 * fixes two problems with the phrase-boundary approach:
 *
 *   1. Short gaps BETWEEN phrases (e.g. a quick breath before the next line)
 *      immediately flipped the old signal to "inactive", causing the singer's
 *      arm to drop and re-raise every few hundred milliseconds during normal
 *      singing. Real vocal audio doesn't have a true silence in these gaps —
 *      amplitude-based detection with hysteresis holds "active" through them.
 *
 *   2. Sung passages with no corresponding NEW IPhrase (e.g. a repeated line
 *      that TextAlive's lyric transcription doesn't re-tag as distinct text,
 *      or an ad-lib/melisma with no transcribed lyric at all) had NO signal
 *      under the old approach — the singer fell back to idle even though the
 *      vocal was clearly audible. Amplitude detection sees the actual singing
 *      regardless of whether it has matching lyric text.
 *
 * ─── API requirements ─────────────────────────────────────────────────────────
 * Player MUST be constructed with `vocalAmplitudeEnabled: true`. Without it,
 * getVocalAmplitude() throws / returns unusable data. isVocalAmplitudeReady()
 * reports whether the data has finished loading (set from the
 * onVocalAmplitudeLoad SongLoaderListener callback in main.ts) — callers
 * should fall back to phrase-boundary detection if this is false, so the
 * feature degrades gracefully rather than breaking if amplitude data fails
 * to load for a particular song.
 *
 * ─── Hysteresis design ─────────────────────────────────────────────────────────
 * Raw amplitude is noisy frame-to-frame even within a single sustained vocal
 * note (consonants, breath, mixing artifacts all dip the signal briefly).
 * A naive "amplitude > threshold" check would flicker on/off many times per
 * second, causing the same rapid arm up/down problem the old phrase-boundary
 * logic had — just for a different reason.
 *
 * The fix is a HOLD-TIME debounce, conceptually identical to a noise gate's
 * release time in audio production:
 *   - Going from inactive → active is immediate (no delay) — the singer should
 *     raise her arm right when singing starts, not lag behind it.
 *   - Going from active → inactive requires the amplitude to stay below
 *     threshold continuously for HOLD_MS before the signal actually flips.
 *     This absorbs both consonant-level dips WITHIN a phrase and short
 *     breath-gaps BETWEEN phrases, while still correctly detecting genuine
 *     multi-second instrumental breaks (which exceed HOLD_MS easily).
 *
 * HOLD_MS is the single tunable constant that controls "how long a gap has to
 * be before the singer puts her arm down." Tune by ear/eye against the actual
 * song — start at 800ms and adjust.
 */

import type { Player } from "textalive-app-api";

// ─── Tunable constants ────────────────────────────────────────────────────────

// Fraction of getMaxVocalAmplitude() above which audio is considered "vocal
// present". [Tunable] — the API docs don't specify amplitude distribution
// shape, so this needs verification against real playback. Start at 0.15 and
// adjust: raise it if instrumental sections falsely register as vocal, lower
// it if quiet singing falsely registers as silence.
const AMPLITUDE_THRESHOLD_FRACTION = 0.10;

// How long (ms) amplitude must stay below threshold before the signal flips
// from active to inactive. This is what prevents short inter-phrase breaths
// and brief audio dips from dropping the singer's arm. [Tunable] — 800ms
// comfortably exceeds a natural breath gap between sung lines while still
// being short enough that real instrumental breaks (several seconds) reliably
// trigger the inactive state well before the section actually ends.
const HOLD_MS = 2000;

// ─── Module state ─────────────────────────────────────────────────────────────

let player: Player | null = null;
let maxAmplitude = 0;
let amplitudeReady = false;

// The debounced output signal. This is what callers read via
// isVocalActiveNow() — NOT the raw frame-to-frame amplitude check.
let debouncedActive = false;

// Timestamp [ms, song position] at which amplitude most recently dropped
// below threshold. Used to measure how long it's been below threshold.
// null means "currently above threshold" (no countdown running).
let belowThresholdSince: number | null = null;

// ─── initVocalPresence ────────────────────────────────────────────────────────

/**
 * Store the Player reference and read getMaxVocalAmplitude() once.
 * Call this from onVideoReady, AFTER onVocalAmplitudeLoad has fired (or after
 * confirming amplitude data is ready) — see setVocalAmplitudeReady().
 *
 * @param p — The live Player instance from main.ts.
 */
export function initVocalPresence(p: Player): void {
  player = p;
  debouncedActive = false;
  belowThresholdSince = null;
}

/**
 * Mark whether vocal amplitude data has finished loading successfully.
 * Call this from the SongLoaderListener.onVocalAmplitudeLoad callback in
 * main.ts: pass true if `reason` is undefined/null (success), false if a
 * reason was given (load failed) — callers should then fall back to
 * phrase-boundary detection instead of trusting this module.
 *
 * Also captures getMaxVocalAmplitude() at this point, since the API requires
 * amplitude data to be loaded before that value is meaningful.
 *
 * @param ready — Whether amplitude data loaded successfully.
 */
export function setVocalAmplitudeReady(ready: boolean): void {
  amplitudeReady = ready;
  if (ready && player) {
    maxAmplitude = player.getMaxVocalAmplitude();
  }
}

/**
 * Whether amplitude-based detection is usable right now. main.ts should check
 * this and fall back to the old phrase-boundary check if false, so a failed
 * amplitude load doesn't silently break the singer's arm/expression logic.
 */
export function isVocalAmplitudeReady(): boolean {
  return amplitudeReady && maxAmplitude > 0;
}

// ─── updateVocalPresence ──────────────────────────────────────────────────────

/**
 * Advance the debounced vocal-presence signal for the current frame.
 * Call this once per frame from tick() in main.ts, BEFORE reading
 * isVocalActiveNow(). Must only be called when isVocalAmplitudeReady() is true
 * — callers are responsible for the fallback branch when it's false.
 *
 * @param position — Current playback position in ms (lastRenderedPosition).
 */
export function updateVocalPresence(position: number): void {
  if (!player || !amplitudeReady || maxAmplitude <= 0) return;

  const amplitude = player.getVocalAmplitude(position);
  const aboveThreshold = amplitude > maxAmplitude * AMPLITUDE_THRESHOLD_FRACTION;

  if (aboveThreshold) {
    // Immediate activation — no delay when singing starts or resumes.
    debouncedActive = true;
    belowThresholdSince = null;
    return;
  }

  // Amplitude is below threshold this frame. Start (or continue) the
  // countdown toward deactivation, but don't flip the output signal until
  // HOLD_MS has elapsed continuously below threshold.
  if (belowThresholdSince === null) {
    belowThresholdSince = position;
  }

  const belowDuration = position - belowThresholdSince;
  if (belowDuration >= HOLD_MS) {
    debouncedActive = false;
  }
  // else: still within the hold window — debouncedActive stays whatever it
  // already was (true, almost always, since we only reach this branch after
  // a period of being active).
}

/**
 * The current debounced vocal-presence signal. Use this instead of checking
 * IPhrase boundaries directly — see module header for why.
 */
export function isVocalActiveNow(): boolean {
  return debouncedActive;
}

/**
 * Reset all state when a new song loads. Call from onVideoReady alongside
 * initVocalPresence(), or instead of it if the Player reference is unchanged
 * across songs (it isn't, in this app's structure, but kept separate for
 * clarity and in case that ever changes).
 */
export function resetVocalPresence(): void {
  debouncedActive = false;
  belowThresholdSince = null;
  amplitudeReady = false;
  maxAmplitude = 0;
}
