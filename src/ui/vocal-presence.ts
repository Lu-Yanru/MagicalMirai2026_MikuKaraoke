/**
 * vocal-presence.ts — Debounced lyric/vocal-presence detection.
 *
 * ─── Why this module exists ───────────────────────────────────────────────────
 * The naive signal for "is the singer currently singing" is checking whether
 * the playback position falls within the current IPhrase's
 * [startTime, endTime) range. That naive check has a real problem: short gaps
 * BETWEEN phrases (a quick breath before the next line, often well under a
 * second) immediately flip the signal to "inactive", causing the singer's
 * left arm to drop and re-raise every few hundred milliseconds during normal
 * singing — visually distracting and not what "is she singing" should mean.
 *
 * The fix is a HOLD-TIME debounce, conceptually identical to a noise gate's
 * release time in audio production:
 *   - Going from inactive → active is immediate (no delay) — the singer should
 *     raise her arm right when a phrase starts, not lag behind it.
 *   - Going from active → inactive requires the raw signal to stay false
 *     continuously for HOLD_MS before the debounced output actually flips.
 *     This absorbs short breath-gaps BETWEEN phrases, while still correctly
 *     detecting genuine multi-second instrumental breaks between song
 *     sections (which exceed HOLD_MS easily).
 *
 * HOLD_MS is the single tunable constant controlling "how long a gap has to
 * be before the singer puts her arm down." Tune by ear/eye against the song.
 *
 * ─── History: why this is phrase-boundary-based, not amplitude-based ────────
 * An earlier version of this module used TextAlive's getVocalAmplitude() /
 * getMaxVocalAmplitude() API to detect singing directly from the audio,
 * independent of transcribed lyric text — which would have ALSO solved a
 * second problem (sung passages with no new IPhrase, e.g. a repeated line or
 * an untranscribed ad-lib, incorrectly registering as silence).
 *
 * That approach was abandoned after live testing showed the API itself is
 * broken in textalive-app-api v0.4.0 (client v0.10.0 / server v0.10.1) for
 * at least the tested song: onVocalAmplitudeLoad fires with no error and
 * delivers a real, populated data array via its callback parameter, but
 * getMaxVocalAmplitude() and getVocalAmplitude() both consistently return
 * `undefined` — confirmed not to be a load-timing race by re-reading at
 * multiple delays (same frame, next rAF tick, +100ms, +1000ms — all
 * undefined). The raw callback parameter is explicitly documented as
 * "unformatted" internal data not meant for direct consumption, so hand-
 * parsing it was rejected as fragile (undocumented format, could silently
 * break on any future SDK update).
 *
 * If a future SDK version fixes these getters, this module's debounce engine
 * (debounceRawSignal / isPresenceActiveNow) can be reused as-is — only the
 * raw boolean fed into it each frame needs to change back to an amplitude
 * threshold check. The debounce logic itself is signal-source-agnostic.
 */

// ─── Tunable constants ────────────────────────────────────────────────────────

// How long (ms) the raw signal must stay false before the debounced signal
// flips from active to inactive. This is what prevents short inter-phrase
// breaths from dropping the singer's arm. [Tunable] — 800ms comfortably
// exceeds a natural breath gap between sung lines while still being short
// enough that real instrumental breaks (several seconds) reliably trigger
// the inactive state well before the section actually ends.
const HOLD_MS = 800;

// ─── Module state ─────────────────────────────────────────────────────────────

// The debounced output signal. Read via isPresenceActiveNow() — NOT the raw
// per-frame input passed to debounceRawSignal().
let debouncedActive = false;

// Timestamp [ms, song position] at which the raw signal most recently went
// false. Used to measure how long it's been false. null means "currently
// true" (no countdown running).
let falseSince: number | null = null;

// ─── debounceRawSignal ────────────────────────────────────────────────────────

/**
 * Advance the debounced presence signal for the current frame.
 * Call this once per frame from tick() in main.ts, BEFORE reading
 * isPresenceActiveNow().
 *
 * @param rawActive — The undebounced signal for this frame (e.g. "is position
 *                    within the active phrase's time range"). Caller decides
 *                    what this means; this function only handles the timing
 *                    smoothing on top of it.
 * @param position  — Current playback position in ms (lastRenderedPosition).
 *                    Used as the time base for the hold countdown so it stays
 *                    pause-safe and seek-safe, consistent with the rest of
 *                    this app's position-driven (not wall-clock-driven) timing.
 */
export function debounceRawSignal(rawActive: boolean, position: number): void {
  if (rawActive) {
    // Immediate activation — no delay when singing starts or resumes.
    debouncedActive = true;
    falseSince = null;
    return;
  }

  // Raw signal is false this frame. Start (or continue) the countdown toward
  // deactivation, but don't flip the output signal until HOLD_MS has elapsed
  // continuously with the raw signal false.
  if (falseSince === null) {
    falseSince = position;
  }

  const falseDuration = position - falseSince;
  if (falseDuration >= HOLD_MS) {
    debouncedActive = false;
  }
  // else: still within the hold window — debouncedActive stays whatever it
  // already was (true, almost always, since we only reach this branch after
  // a period of being active).
}

/**
 * The current debounced presence signal. Use this instead of checking the
 * raw per-frame signal directly — see module header for why.
 */
export function isPresenceActiveNow(): boolean {
  return debouncedActive;
}

/**
 * Reset all state when a new song loads.
 */
export function resetVocalPresence(): void {
  debouncedActive = false;
  falseSince = null;
}
