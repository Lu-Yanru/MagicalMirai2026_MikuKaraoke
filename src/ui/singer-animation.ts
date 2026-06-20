/**
 * singer-animation.ts — Beat-driven singer animations.
 *
 * Drives four visual effects every animation frame via updateSingerAnimation(),
 * which is called from the existing tick() loop in main.ts:
 *
 *   1. Head shake      — sinusoidal left/right rotation, ±4°, to the beat.
 *   2. Pigtail shake   — same phase as head, ±6° (larger range feels natural
 *                        because long pigtails amplify small rotations visually).
 *   3. Arm swing        — one-directional swing UP from rest, never below rest,
 *                        12° max, to the beat. Applied to arm_right always, and
 *                        to arm_left ONLY while it is in the "down" pose (no
 *                        active lyric). Both arms swing with identical phase
 *                        and degree — they lift together on every beat.
 *                        arm_left in its "up" pose (active lyric) is static —
 *                        no swing is applied while singing.
 *   4. Mouth animation  — src swap between mouth_small / mouth_big on each beat
 *                        boundary, only during active lyrics and only for the
 *                        expressions that have mouth variants (happy, singing).
 *
 * Additionally exports setSingerLyricState(), called from the phrase-advance
 * logic in main.ts to swap the left arm between up and down positions.
 *
 * ─── Transform origins ───────────────────────────────────────────────────────
 * All layer PNGs share the same 1673×1816 canvas. transform-origin percentages
 * are relative to the element's own bounding box, which equals the full canvas
 * because every layer img is width:100% height:100% of the container.
 *
 *   Head + pigtails: rotate around the neck.
 *     Measured from singer_idle.png: x=814px (48.7%), y=635px (35.0%).
 *     Rounded to 49% / 35% for CSS.
 *
 *   arm_right: rotate around the right shoulder.
 *     Measured directly from the isolated arm_right.png layer (content
 *     bounding box top-center, where the arm attaches to the torso):
 *     x=654px (39.0%), y=767px (42.0%).
 *
 *   arm_left (down pose): rotate around the left shoulder.
 *     Measured directly from the isolated arm_left_down.png layer:
 *     x=851px (50.9%), y=765px (41.9%).
 *
 * ─── Arm swing direction ──────────────────────────────────────────────────────
 * The two arms hang on opposite sides of the body, so raising each one
 * requires opposite-sign CSS rotation even though the visual effect (lifting)
 * is the same direction. Determined geometrically from the shoulder→hand
 * vector in each isolated layer:
 *   arm_right:     hand sits left-and-below the shoulder → POSITIVE rotation
 *                  (clockwise) raises it.
 *   arm_left_down: hand sits right-and-below the shoulder → NEGATIVE rotation
 *                  (counter-clockwise) raises it.
 * Both use sin(phase×π) (always ≥ 0 across one beat) scaled by ARM_MAX_DEG, so
 * the arm only ever swings UP from its rest pose and back down to rest — it
 * never swings below where it started. This satisfies the "must not swing
 * down past the current position" requirement without any clamping logic;
 * the non-negative sine curve guarantees it structurally.
 *
 * ─── Beat phase calculation ───────────────────────────────────────────────────
 * IBeat.startTime is the timestamp [ms] of beat N.
 * The next beat starts at beats[N+1].startTime (or phrase end for the last beat).
 * phase = (position - beat.startTime) / (nextBeat.startTime - beat.startTime)
 * phase runs 0→1 over the duration of one beat.
 * sin(phase × π): 0 at beat start, peak at midpoint, 0 again at beat end.
 * This makes the motion feel locked to the beat without snapping.
 *
 * ─── Pause / seek safety ─────────────────────────────────────────────────────
 * All motion is driven by `position` (lastRenderedPosition from main.ts), not
 * wall-clock time. Pausing freezes position → freezes the transform. Seeking
 * jumps position → the binary search finds the correct beat instantly.
 * No cleanup needed on pause or seek.
 */

import type { IBeat } from "textalive-app-api";
import type { SingerState } from "../types";

import armLeftUp from "/src/assets/singer/arm_left_up.png";
import armLeftDown from "/src/assets/singer/arm_left_down.png";
import headHappySmall from "/src/assets/singer/head_happy_mouth_small.png";
import headHappyBig from "/src/assets/singer/head_happy_mouth_big.png";
import headSingingSmall from "/src/assets/singer/head_singing_mouth_small.png";
import headSingingBig from "/src/assets/singer/head_singing_mouth_big.png";

// ─── DOM references ───────────────────────────────────────────────────────────
// Grabbed once at init time. Null-checked before use in case init is called
// before the DOM is ready (shouldn't happen — module is deferred).

let elHead:         HTMLImageElement | null = null;
let elPigtailLeft:  HTMLImageElement | null = null;
let elPigtailRight: HTMLImageElement | null = null;
let elArmRight:     HTMLImageElement | null = null;
let elArmLeft:      HTMLImageElement | null = null;

// ─── Beat data ────────────────────────────────────────────────────────────────
// Full IBeat[] from player.data.songMap.beats, set once in initSingerAnimation.
let beats: IBeat[] = [];

// ─── Animation constants ──────────────────────────────────────────────────────

// Maximum rotation angle for head shake, in degrees. ±4° is subtle enough
// to feel like a gentle sway rather than a violent shake.
const HEAD_MAX_DEG = 4;

// Pigtails use the same neck origin but a larger angle. Long hair amplifies
// the visual arc at the tips, so ±6° reads as proportional to the head.
const PIGTAIL_MAX_DEG = 6;

// Arms swing further because arms have more natural range of motion.
const ARM_MAX_DEG = 12;

// Transform origins as percentages of the full canvas (1673×1816).
// Applied once via inline style on each element — these are static values,
// not animated, so a one-time JS assignment is simpler than a CSS class.
const NECK_ORIGIN          = "49% 35%";   // measured neck (head + pigtails)
const ARM_RIGHT_ORIGIN     = "39% 42%";   // measured from arm_right.png
const ARM_LEFT_DOWN_ORIGIN = "51% 42%";   // measured from arm_left_down.png

// Rotation sign for each arm to swing UP from rest (never below rest).
// Determined geometrically from the shoulder→hand vector in each isolated
// layer — see header comment for the measurement. The two arms hang on
// opposite sides of the body, so lifting both requires opposite CSS signs.
const ARM_RIGHT_SIGN = 1;   // positive (clockwise) raises arm_right
const ARM_LEFT_SIGN  = -1;  // negative (counter-clockwise) raises arm_left_down

// ─── Mouth animation state ────────────────────────────────────────────────────
// Tracks which mouth variant is currently shown and which beat index was last
// used for a mouth swap, so swaps happen exactly once per beat boundary.

let mouthOpen       = false;  // false = small, true = big
let lastMouthBeatIdx = -1;    // beat index of the most recent mouth swap

// ─── Lyric state ─────────────────────────────────────────────────────────────
// Whether a phrase is currently active. Drives left arm src and mouth animation.
let hasActiveLyric = false;

// ─── Current singer state ─────────────────────────────────────────────────────
// Kept in sync by updateSingerAnimation() so mouth swap uses the right filenames.
let singerState: SingerState = "idle";

// ─── initSingerAnimation ─────────────────────────────────────────────────────

/**
 * Grab DOM element references and store the full beat array.
 * Must be called once from main.ts after the DOM is ready and onVideoReady
 * has fired (so player.data.songMap.beats is populated).
 *
 * @param allBeats — player.data.songMap.beats, full song beat list.
 */
export function initSingerAnimation(allBeats: IBeat[]): void {
  beats = allBeats;

  elHead         = document.getElementById("singer-head")          as HTMLImageElement;
  elPigtailLeft  = document.getElementById("singer-pigtail-left")  as HTMLImageElement;
  elPigtailRight = document.getElementById("singer-pigtail-right") as HTMLImageElement;
  elArmRight     = document.getElementById("singer-arm-right")     as HTMLImageElement;
  elArmLeft      = document.getElementById("singer-arm-left")      as HTMLImageElement;

  // Apply transform-origin once — it does not change per frame.
  // These are percentage values relative to each element's own bounding box,
  // which equals the full canvas because every layer is width:100% height:100%.
  if (elHead)         elHead.style.transformOrigin         = NECK_ORIGIN;
  if (elPigtailLeft)  elPigtailLeft.style.transformOrigin  = NECK_ORIGIN;
  if (elPigtailRight) elPigtailRight.style.transformOrigin = NECK_ORIGIN;
  if (elArmRight)     elArmRight.style.transformOrigin     = ARM_RIGHT_ORIGIN;
  if (elArmLeft)      elArmLeft.style.transformOrigin      = ARM_LEFT_DOWN_ORIGIN;
}

// ─── setSingerLyricState ──────────────────────────────────────────────────────

/**
 * Switch the left arm between up (active lyric) and down (no lyric) positions.
 * Called from the phrase-advance logic in main.ts, not from tick().
 *
 * @param active — true when a phrase just became active; false when song ends
 *                 or between sections with no active phrase.
 */
export function setSingerLyricState(active: boolean): void {
  hasActiveLyric = active;
  if (!elArmLeft) return;
  elArmLeft.src = active
    ? armLeftUp
    : armLeftDown;
}

// ─── setSingerExpressionState ─────────────────────────────────────────────────

/**
 * Update the stored singer state so mouth swaps use the correct image filenames.
 * Called from main.ts whenever getSingerState() returns a new value.
 *
 * For "happy" and "singing" — which have mouth_small/mouth_big variants — this
 * immediately sets the head src to the mouth_small frame so there is no gap
 * between the state change and the next beat boundary (when the beat-driven
 * mouth swap in updateSingerAnimation would otherwise first set the src).
 *
 * For "idle" and "sad" — which have a single static head image — this does
 * NOT set elHead.src. main.ts owns those two states directly since they have
 * no mouth animation and no per-beat logic.
 *
 * @param state — The new SingerState.
 */
export function setSingerExpressionState(state: SingerState): void {
  singerState = state;
  mouthOpen = false;
  lastMouthBeatIdx = -1;

  if (state === "singing" && elHead) {
    elHead.src = headHappySmall;
  }
  else if (state === "singing" && elHead){
    elHead.src = headSingingSmall;
  }
}

// ─── updateSingerAnimation ────────────────────────────────────────────────────

/**
 * Update all beat-driven singer animations for the current playback position.
 * Call this once per frame from tick() in main.ts.
 *
 * @param position  — Current playback position in ms (lastRenderedPosition).
 * @param isPlaying — Whether the player is currently playing. Animations freeze
 *                    when paused because position stops advancing; no extra
 *                    handling needed, but we skip work when not playing.
 */
export function updateSingerAnimation(
  position: number,
  isPlaying: boolean
): void {
  if (!isPlaying || beats.length === 0) {
    // Paused or not started — hold current transforms (don't reset to zero,
    // which would cause a visible snap when the player hits pause mid-swing).
    return;
  }

  // ── Find current beat via binary search ───────────────────────────────────
  // We want the last beat whose startTime <= position.
  let lo = 0;
  let hi = beats.length - 1;
  let beatIdx = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].startTime <= position) {
      beatIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const beat     = beats[beatIdx];
  const nextBeat = beats[beatIdx + 1];

  // ── Compute beat phase (0 → 1) ────────────────────────────────────────────
  // phase = how far through the current beat we are.
  // If there is no next beat (last beat of song), use a fixed duration of
  // 500ms (reasonable fallback; the song is ending anyway).
  const beatDuration = nextBeat
    ? nextBeat.startTime - beat.startTime
    : 500;

  const phase = Math.min(
    (position - beat.startTime) / beatDuration,
    1
  );

  // ── Sinusoidal rotation value ─────────────────────────────────────────────
  // sin(phase × π) produces a smooth arc: 0 at beat start, peak at midpoint,
  // 0 again at beat end. This value is always >= 0 across the full beat, which
  // is exactly what the one-directional arm swing relies on (see below).
  const sinVal = Math.sin(phase * Math.PI);

  // Head + pigtails: alternate shake direction every beat (left, right, left...).
  // This alternation is appropriate for a side-to-side head shake but NOT for
  // the arm swing (see below) — flipping sign on the arm would swing it below
  // its rest pose on alternating beats, which violates the "never swing below
  // rest" requirement.
  const shakeSign  = beatIdx % 2 === 0 ? 1 : -1;
  const headDeg    = shakeSign * sinVal * HEAD_MAX_DEG;
  const pigtailDeg = shakeSign * sinVal * PIGTAIL_MAX_DEG;

  // Arms: NO sign alternation. sinVal alone is always >= 0, so multiplying by
  // a fixed per-arm sign (ARM_RIGHT_SIGN / ARM_LEFT_SIGN) means the arm always
  // rotates in the SAME direction every beat — up from rest, back to rest,
  // never past rest in the opposite direction. Both arms use the identical
  // sinVal and ARM_MAX_DEG, so they lift with the same phase and magnitude.
  const armRightDeg = ARM_RIGHT_SIGN * sinVal * ARM_MAX_DEG;
  const armLeftDeg  = ARM_LEFT_SIGN  * sinVal * ARM_MAX_DEG;

  // ── Apply transforms ──────────────────────────────────────────────────────
  if (elHead)         elHead.style.transform         = `rotate(${headDeg}deg)`;
  if (elPigtailLeft)  elPigtailLeft.style.transform  = `rotate(${pigtailDeg}deg)`;
  if (elPigtailRight) elPigtailRight.style.transform = `rotate(${pigtailDeg}deg)`;
  if (elArmRight)     elArmRight.style.transform     = `rotate(${armRightDeg}deg)`;

  // arm_left only swings while it is in the "down" pose (no active lyric).
  // While "up" (active lyric), it stays static — no transform is applied,
  // and any residual rotation from a previous "down" phase is cleared so the
  // up pose always renders at its natural orientation.
  if (elArmLeft) {
    elArmLeft.style.transform = hasActiveLyric
      ? "rotate(0deg)"
      : `rotate(${armLeftDeg}deg)`;
  }

  // ── Mouth animation ───────────────────────────────────────────────────────
  // Swap between mouth_small and mouth_big once per beat boundary.
  // Only fires during active lyrics and for expressions with mouth variants.
  // The swap happens when beatIdx changes (new beat started).
  if (
    hasActiveLyric &&
    beatIdx !== lastMouthBeatIdx &&
    (singerState === "happy" || singerState === "singing")
  ) {
    lastMouthBeatIdx = beatIdx;
    mouthOpen = !mouthOpen;

    if (elHead) {
      if (singerState === "happy" && !mouthOpen) {
        elHead.src = headHappySmall;
      }
      else if (singerState === "happy" && mouthOpen) {
        elHead.src = headHappyBig;
      }
      else if (singerState === "singing" && !mouthOpen) {
        elHead.src = headSingingSmall;
      }
      else if (singerState === "singing" && mouthOpen) {
        elHead.src = headSingingBig;
      }
    }
  }
}
