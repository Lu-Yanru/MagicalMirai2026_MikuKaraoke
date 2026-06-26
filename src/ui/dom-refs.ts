/**
 * dom-refs.ts — Central lookup of DOM elements used by main.ts, and by the
 * handful of other modules that need the same elements (input-controller.ts,
 * loading-controls.ts).
 *
 * Elements used by exactly one OTHER module (the end-screen panel, the
 * singer head image, the fullscreen buttons) are looked up locally inside
 * that module instead of here — this file only exists to avoid the same
 * getElementById call being duplicated across files.
 *
 * Grabbed once at module load time. Safe because index.html's script tag is
 * type="module" (deferred) — the DOM is fully parsed before this file runs.
 */

import type { Direction } from "../types";

export const phraseTopSlot    = document.getElementById("phrase-top")    as HTMLElement;
export const phraseBottomSlot = document.getElementById("phrase-bottom") as HTMLElement;
export const lyricOverlay     = document.getElementById("lyric-overlay") as HTMLElement;

export const btnPlay    = document.getElementById("btn-play")     as HTMLButtonElement;
export const btnPlayImg = document.getElementById("btn-play-img") as HTMLImageElement;

export const scoreEl     = document.getElementById("score")      as HTMLElement;
export const comboEl     = document.getElementById("combo")      as HTMLElement;
export const songTitleEl = document.getElementById("song-title") as HTMLElement;

export const btnPlayAgain = document.getElementById("btn-play-again") as HTMLButtonElement;
export const btnMainMenu  = document.getElementById("btn-main-menu")  as HTMLButtonElement;

// ── Input pad ──────────────────────────────────────────────────────────────
export const inputPad = document.getElementById("input-pad") as HTMLElement;

// Button refs keyed by Direction, so the keyboard handler can toggle the
// same `.key-pressed` CSS class that touch/mouse presses get for free via
// the native :active pseudo-class — pressing an arrow key visually presses
// its on-screen button too.
export const directionButtons: Record<Direction, HTMLButtonElement> = {
  up:    inputPad.querySelector('[data-direction="up"]')    as HTMLButtonElement,
  down:  inputPad.querySelector('[data-direction="down"]')  as HTMLButtonElement,
  left:  inputPad.querySelector('[data-direction="left"]')  as HTMLButtonElement,
  right: inputPad.querySelector('[data-direction="right"]') as HTMLButtonElement,
};
