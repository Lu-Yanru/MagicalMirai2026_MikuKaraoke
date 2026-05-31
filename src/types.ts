/**
 * types.ts — Shared TypeScript type definitions used across the entire app.
 *
 * All types are defined here in one place so that game logic, UI modules, and
 * main.ts can import a single source of truth without circular dependencies.
 *
 * IChar is imported from the TextAlive App API package. All other types are
 * local to this project.
 */

import type { IChar, IPhrase } from "textalive-app-api";

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
 * The scheduler creates one CueEntry per beat that coincides with the start
 * of a new lyric character (within ±100 ms). Each entry tracks its own
 * lifecycle from creation through resolution.
 *
 * Fields:
 *   beatTime   — The beat timestamp in milliseconds from the TextAlive API.
 *                This is the "target" time the player aims to press on.
 *   char       — The IChar object whose startTime matched this beat. Used by
 *                the UI layer to position the arrow overlay on the correct
 *                character span.
 *   direction  — One of the four directions, randomly assigned at schedule
 *                build time (before playback starts).
 *   element    — The live <div> for the on-screen arrow/rating display.
 *                null before the cue is spawned, null again after it is
 *                removed from the DOM.
 *   timeoutId  — Handle returned by setTimeout() for the miss deadline.
 *                Stored so we can clearTimeout() on a successful hit before
 *                the miss fires.
 *   resolved   — True once this cue has been rated (either by a player press
 *                or by the miss timeout). Guards against double-scoring.
 *
 * Note on IChar.next typing:
 *   IChar overrides `.next` from its parent ITextUnit and narrows the type to
 *   IChar (likewise `.previous: IChar` and `.parent: IWord`). No cast is needed
 *   when walking the linked list — `char = char.next` is type-safe as-is.
 *   Verified against the live API docs:
 *   https://developer.textalive.jp/packages/textalive-app-api/interfaces/IChar.html
 */
export interface CueEntry {
  beatTime: number;
  char: IChar;
  direction: Direction;
  element: HTMLElement | null;
  timeoutId: number | null;
  resolved: boolean;
  barPosition: number; // 0–100, left% position on the phrase's cue bar
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
