/**
 * rating.ts — Cue resolution: replace arrow icon with rating word + animation.
 *
 * Exported surface:
 *   RATING_COLORS  — color string for each RatingType, used for the text.
 *   RATING_LABELS  — display string for each RatingType.
 *   resolveCue()   — called by scoring.ts (player hit) or miss timeout (Miss).
 *
 * Visual behaviour:
 *   When a cue resolves, the arrow character inside the cue <div> is replaced
 *   by the rating label in the matching color. The CSS class `cue-resolved` is
 *   added, which triggers a float-up + fade-out keyframe animation. After the
 *   animation completes (~600ms) the element is removed from the DOM and
 *   entry.element is set to null so no code can reference a detached node.
 *
 * Design note on transforms:
 *   .cue already has `transform: translate(-50%, -50%)` for centering.
 *   The `ratingPop` keyframe must preserve the -50%/-50% centering translation
 *   on the X axis while animating the Y offset. It does this by using
 *   `translate(-50%, Ypx)` throughout — the Y value animates from 0 to -36px
 *   while X stays fixed at -50%.
 */

import type { CueEntry } from "../types";
import type { RatingType } from "../types";

// ─── Rating color map ─────────────────────────────────────────────────────────

/**
 * Display color for each rating tier.
 * These are applied as inline `color` on the cue element when it resolves.
 */
export const RATING_COLORS: Record<RatingType, string> = {
  Perfect: "#5b9cf6", // blue
  Great:   "#4ade80", // green
  Good:    "#facc15", // yellow
  Bad:     "#c084fc", // purple
  Miss:    "#f87171", // red
};

// ─── Rating label map ─────────────────────────────────────────────────────────

/**
 * Human-readable label displayed in the cue div when it resolves.
 * Kept short so it fits inside the bar track without overflow.
 */
export const RATING_LABELS: Record<RatingType, string> = {
  Perfect: "Perfect",
  Great:   "Great",
  Good:    "Good",
  Bad:     "Bad",
  Miss:    "Miss",
};

// ─── resolveCue ───────────────────────────────────────────────────────────────

/**
 * Resolve a cue entry with the given rating.
 *
 * Steps:
 *   1. Guard: if already resolved, return immediately to prevent double-scoring
 *      or a second animation on the same element.
 *   2. Mark the entry resolved so no further calls can act on it.
 *   3. Replace the arrow text with the rating label in the matching color.
 *   4. Add `.cue-resolved` to start the float-up CSS animation.
 *   5. After ANIMATION_DURATION_MS, remove the element from the DOM and null
 *      out entry.element so stale references are obvious rather than silent.
 *
 * @param entry  — The CueEntry whose visual cue <div> should be resolved.
 * @param rating — The rating to display (Perfect / Great / Good / Bad / Miss).
 */
export function resolveCue(entry: CueEntry, rating: RatingType): void {
  // ── Guard: already resolved ───────────────────────────────────────────────
  // This can happen if a player press and the miss timeout race each other —
  // the timeout fires on the same frame as a late press in the tolerance window.
  if (entry.resolved) return;

  // ── Mark resolved immediately ─────────────────────────────────────────────
  // Set this before any async work so a second call on the same tick still
  // exits at the guard above.
  entry.resolved = true;

  // ── Bail if the cue element was never created or already removed ──────────
  // This shouldn't happen under normal flow, but guards against edge cases
  // where a phrase was advanced before the element was attached to the DOM.
  const el = entry.element;
  if (!el) return;

  // ── Replace arrow with rating label ──────────────────────────────────────
  el.textContent = RATING_LABELS[rating];
  el.style.color = RATING_COLORS[rating];

  // Slightly larger font for the label text so it's readable inside the bar.
  // The arrow was 1.3rem (set in CSS); labels are short strings, same size is fine.
  // No change needed — inherits .cue font-size.

  // ── Trigger float-up animation ────────────────────────────────────────────
  // Adding this class starts the `ratingPop` CSS keyframe defined in style.css.
  // The animation is `forwards` so the element stays at opacity 0 until removed.
  el.classList.add("cue-resolved");

  // ── Schedule DOM removal ──────────────────────────────────────────────────
  // 600ms matches the animation duration in style.css. After this the element
  // is invisible (opacity: 0 from the `forwards` fill) so removal is seamless.
  // We null entry.element so any code that checks it later knows the node is gone.
  const ANIMATION_DURATION_MS = 600;
  setTimeout(() => {
    el.remove();
    entry.element = null;
  }, ANIMATION_DURATION_MS);
}
