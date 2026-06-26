/**
 * singer-expression.ts — Decides which head image to show for the singer
 * sprite.
 *
 * Centralizes the rule for which head image to show, since it depends on
 * TWO independent inputs that change at different times:
 *   - the score-driven SingerState (idle/happy/singing/sad)
 *   - whether a lyric is currently active (position-driven)
 *
 * Rule:
 *   No active lyric (instrumental section / before song starts):
 *     - state === "happy" → head_happy_mouth_big.png (stays open-mouth happy)
 *     - otherwise         → head_idle.png (always reverts to idle)
 *   Active lyric:
 *     - "idle" / "sad"      → static src set directly here.
 *     - "happy" / "singing" → delegated to setSingerExpressionState(), which
 *       sets the initial mouth_small frame and hands ongoing beat-driven
 *       mouth swaps to updateSingerAnimation() in tick() (main.ts).
 *
 * Called from main.ts in two places: the scoreupdate listener (state just
 * changed) and the lyric-active transition in tick() (lyric just
 * started/stopped). Both sites need the exact same decision, so the rule
 * lives here once.
 */

import { setSingerExpressionState } from "./singer-animation";
import type { SingerState } from "../types";

import headHappyBig from "/src/assets/singer/head_happy_mouth_big.png";
import headIdle from "/src/assets/singer/head_idle.png";
import headSad from "/src/assets/singer/head_sad.png";

// singerHead: the topmost layer — head_idle / head_happy / head_singing /
// head_sad. Only this layer's src is swapped on state change. Body, arms,
// and pigtails stay on their default src; their own animation lives in
// singer-animation.ts.
const singerHead = document.getElementById("singer-head") as HTMLImageElement;

export function applySingerExpression(state: SingerState, lyricActive: boolean): void {
  if (!lyricActive) {
    // No lyric playing — idle by default, except happy holds its open-mouth pose.
    singerHead.src = state === "happy" ? headHappyBig : headIdle;
    // Stop any in-progress beat-driven mouth swap bookkeeping so that if a
    // lyric starts again on this same state, the mouth animation resumes
    // cleanly from mouth_small rather than from wherever it left off.
    setSingerExpressionState(state === "happy" ? "happy" : "idle");
    return;
  }

  // Lyric IS active — normal per-state handling.
  if (state === "idle") {
    singerHead.src = headIdle;
  } else if (state === "sad") {
    singerHead.src = headSad;
  }
  // "happy" / "singing" while a lyric is active: beat-driven mouth animation
  // owns the src from here on, via setSingerExpressionState() + tick().
  setSingerExpressionState(state);
}
