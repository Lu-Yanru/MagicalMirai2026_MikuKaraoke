/**
 * types.ts — Shared TypeScript type definitions used across the entire app.
 *
 * All types are defined here in one place so that game logic, UI modules, and
 * main.ts can import a single source of truth without circular dependencies.
 *
 * IChar is imported from the TextAlive App API package. All other types are
 * local to this project.
 */

import type { IBeat, IPhrase } from "textalive-app-api";

// ─── Input ────────────────────────────────────────────────────────────────────

/**
 * The four directional inputs the player can press.
 * Used both for arrow cue assignment and for mapping keyboard / touch events.
 */
export type Direction = "up" | "down" | "left" | "right";

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * The five possible outcomes when a cue is resolved.
 *
 * Perfect / Great / Good / Bad — player pressed the correct direction within
 *   the respective timing window (see game-design.md for exact ms values).
 * Miss — the timing window expired with no correct press, or the wrong
 *   direction was pressed and the window later expired.
 */
export type RatingType = "Perfect" | "Great" | "Good" | "Bad" | "Miss";

// ─── Cue schedule ─────────────────────────────────────────────────────────────

/**
 * One arrow cue entry in the schedule built by scheduler.ts.
 *
 * The scheduler creates one CueEntry per selected beat within a phrase,
 * chosen by the beat-based selection algorithm (eligibility filter →
 * density targeting → phase rotation → spacing enforcement).
 *
 * Fields:
 *   beatTime   — The beat's startTime in milliseconds. This is the "target"
 *                time the player aims to press on; used for hit detection.
 *   beat       — The IBeat object this cue is tied to. Carries .position
 *                (0-based index within the bar) and .length (beats per bar),
 *                useful for debugging and any future scoring nuance.
 *   direction  — One of the four directions, randomly assigned at schedule
 *                build time (before playback starts).
 *   barPosition — 0–100 left% position along the phrase's cue bar, calculated
 *                as (beatTime − phrase.startTime) / phraseDuration × 100.
 *   element    — The live <div> for the on-screen arrow/rating display.
 *                null before the phrase is activated, null again after the
 *                rated element is removed from the DOM.
 *   timeoutId  — Handle returned by setTimeout() for the miss deadline.
 *                Cleared via clearTimeout() on a successful player hit.
 *   resolved   — True once this cue has been rated (player press or miss
 *                timeout). Guards against double-scoring.
 *
 * IBeat docs:
 *   https://developer.textalive.jp/packages/textalive-app-api/interfaces/IBeat.html
 */
export interface CueEntry {
  beatTime: number;
  beat: IBeat;          // carries .position and .length for the owning bar
  direction: Direction;
  barPosition: number;  // 0–100, left% position on the phrase's cue bar
  element: HTMLElement | null;
  timeoutId: number | null;
  resolved: boolean;
}

// ─── Phrase rows ──────────────────────────────────────────────────────────────
 
/**
 * One display row in the two-row lyric overlay, wrapping an IPhrase together
 * with all the DOM elements and cue entries that belong to it.
 *
 * PhraseRows are built once in initLyrics() (Chunk 5) before playback starts
 * and then activated/deactivated as the song progresses.
 *
 * Fields:
 *   phrase          — The TextAlive IPhrase object supplying startTime,
 *                     endTime, and text.
 *   cues            — All CueEntry objects whose beatTime falls within this
 *                     phrase's time range. Built by scheduler.ts.
 *   element         — The <div class="phrase-row"> container. null until
 *                     initLyrics() creates it; set to null again if the row
 *                     is ever removed from the DOM.
 *   coloredLayer    — The teal <div class="phrase-colored"> whose clip-path
 *                     is updated every frame by updateLyrics(). null until
 *                     initLyrics() creates it.
 *   playheadElement — The <div class="playhead"> that slides across the bar.
 *                     null until initLyrics() creates it.
 *
 * IPhrase docs:
 *   https://developer.textalive.jp/packages/textalive-app-api/interfaces/IPhrase.html
 * Note: IPhrase.next is typed as IPhrase (narrows from IRenderingUnit),
 *   so walking the phrase linked list requires no cast.
 */
export interface PhraseRow {
  phrase: IPhrase;
  cues: CueEntry[];
  element: HTMLElement | null;
  coloredLayer: HTMLElement | null;
  playheadElement: HTMLElement | null;
  // Timestamps [ms] at which the waiting playhead should flash, in ascending
  // order. These are the startTimes of the beats in the bar immediately before
  // this phrase starts. Built once in buildSchedule() and consumed each frame
  // in tick(). Empty if there are no beats before the phrase.
  blinkBeats: IBeat[];
}

// ─── Score state ──────────────────────────────────────────────────────────────

/**
 * The complete scoring state maintained by scoring.ts.
 *
 * Fields:
 *   score    — Cumulative point total for the current song run.
 *   combo    — Current unbroken streak of Perfect / Great / Good hits.
 *              Resets to 0 on Bad or Miss.
 *   maxCombo — Highest combo reached so far; shown on the results screen.
 *   counts   — How many of each RatingType have occurred. Used on the
 *              end screen to show a breakdown (e.g. "Perfect: 12, Miss: 3").
 */
export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<RatingType, number>;
}

// ─── Singer state ─────────────────────────────────────────────────────────────

/**
 * The four visual states of the singer character sprite.
 *
 *   idle  — Before the song starts, or when no phrase is active.
 *   happy — Triggered by a Perfect hit or a combo of 10 or more.
 *   singing — Active while combo is between 5 and 9 (inclusive).
 *   sad   — Triggered by a Miss or Bad rating, or when combo drops to 0.
 *
 * State transitions are handled by singer.ts and applied by swapping the
 * <img> src attribute in main.ts.
 */
export type SingerState = "idle" | "happy" | "singing" | "sad";
