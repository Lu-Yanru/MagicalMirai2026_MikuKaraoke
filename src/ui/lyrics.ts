/**
 * lyrics.ts — Lyric rendering, phrase display, and clip-path color fill.
 *
 * Responsibilities:
 *   - Build all phrase row DOM elements upfront at load time (initLyrics).
 *   - Insert a phrase row into the active or next slot on demand (activatePhrase).
 *   - Update the teal color fill every animation frame (updateLyrics).
 *
 * This module owns all DOM construction for the lyric overlay. It never reads
 * from the DOM after building — all live references are stored on PhraseRow
 * fields and updated directly.
 */

import type { PhraseRow } from "../types";

// ─── Arrow direction → Unicode character map ──────────────────────────────────
// Used to render the arrow symbol inside each cue <div>.
const DIRECTION_CHARS: Record<string, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

// ─── initLyrics ───────────────────────────────────────────────────────────────

/**
 * Build the DOM element tree for every phrase row and store element references
 * on each PhraseRow. Does NOT attach any rows to the live document — rows are
 * inserted on demand by activatePhrase().
 *
 * Must be called once from onVideoReady, after buildSchedule() has populated
 * each PhraseRow's cues array.
 *
 * @param phraseRows — The full ordered list of PhraseRows built by the scheduler.
 */
export function initLyrics(phraseRows: PhraseRow[]): void {
  for (const row of phraseRows) {
    // ── Phrase row container ────────────────────────────────────────────────
    // The outer <div> holds the text wrap and the cue bar as a flex column.
    // CSS class "phrase-row" is always present; "active" or "next" is added
    // by activatePhrase() when the row is inserted into a slot.
    const rowEl = document.createElement("div");
    rowEl.className = "phrase-row";
    row.element = rowEl;

    // ── Text wrap ───────────────────────────────────────────────────────────
    // Two absolutely-overlapping divs produce the karaoke color fill:
    //   .phrase-dim     — always fully visible; the "unsung" colour
    //   .phrase-colored — teal layer clipped to reveal left-to-right
    //
    // Both contain the full phrase text as a plain string. No per-character
    // splitting is needed — the clip-path alone drives the fill effect.
    const textWrap = document.createElement("div");
    textWrap.className = "phrase-text-wrap";

    const dimLayer = document.createElement("div");
    dimLayer.className = "phrase-dim";
    dimLayer.textContent = row.phrase.text;

    const coloredLayer = document.createElement("div");
    coloredLayer.className = "phrase-colored";
    coloredLayer.textContent = row.phrase.text;
    // Start fully hidden (clip away 100% from the right). updateLyrics()
    // will open this up left-to-right as the playhead advances.
    coloredLayer.style.clipPath = "inset(0 100% 0 0)";
    row.coloredLayer = coloredLayer;

    textWrap.appendChild(dimLayer);
    textWrap.appendChild(coloredLayer);

    // ── Cue bar ─────────────────────────────────────────────────────────────
    // .bar-track is the horizontal groove. It contains:
    //   - One .cue <div> per CueEntry, pre-placed at barPosition%.
    //   - One .playhead <div> that slides left→right each frame.
    //
    // All cues for the phrase are rendered upfront so the player can see
    // what's coming before the playhead reaches each one.
    const barTrack = document.createElement("div");
    barTrack.className = "bar-track";

    for (const cue of row.cues) {
      const cueEl = document.createElement("div");
      cueEl.className = "cue";
      // barPosition is 0–100 (percentage along the bar), calculated by the
      // scheduler relative to the phrase's startTime / endTime span.
      cueEl.style.left = `${cue.barPosition}%`;
      cueEl.textContent = DIRECTION_CHARS[cue.direction] ?? "?";
      // Store the live element reference so rating.ts can update it later.
      cue.element = cueEl;
      barTrack.appendChild(cueEl);
    }

    // Playhead dot — position updated every frame by the rAF loop in main.ts.
    const playheadEl = document.createElement("div");
    playheadEl.className = "playhead";
    playheadEl.style.left = "0%";
    row.playheadElement = playheadEl;
    barTrack.appendChild(playheadEl);

    // Assemble: text wrap then cue bar, both inside the row container.
    rowEl.appendChild(textWrap);
    rowEl.appendChild(barTrack);

    // Do NOT append rowEl to the document here. activatePhrase() does that
    // when it is time for this row to become visible.
  }
}

// ─── activatePhrase ───────────────────────────────────────────────────────────

/**
 * Insert a phrase row into either the top (active) or bottom (next) slot of
 * the lyric overlay, replacing whatever was there before.
 *
 * "Activation" means:
 *   1. Clear the target slot's current content.
 *   2. Set the correct CSS class on the row element ("active" or "next").
 *   3. Append the row element to the slot.
 *
 * The active slot maps to #phrase-top; the next slot maps to #phrase-bottom.
 * Both elements are assumed to exist in the DOM (created in index.html,
 * Chunk 4 Step 1).
 *
 * @param row      — The PhraseRow to display.
 * @param topSlot  — The #phrase-top container element.
 * @param bottomSlot — The #phrase-bottom container element.
 * @param isTop    — true to place the row in the active (top) slot,
 *                   false to place it in the next (bottom) slot.
 */
export function activatePhrase(
  row: PhraseRow,
  topSlot: HTMLElement,
  bottomSlot: HTMLElement,
  isTop: boolean
): void {
  if (!row.element) return;

  const slot = isTop ? topSlot : bottomSlot;

  // Remove the previous occupant of this slot.
  slot.innerHTML = "";

  // Apply the correct visibility class before inserting.
  // "active" → full opacity; "next" → dimmed (opacity: 0.4 in CSS).
  row.element.classList.remove("active", "next");
  row.element.classList.add(isTop ? "active" : "next");

  slot.appendChild(row.element);
}

// ─── updateLyrics ─────────────────────────────────────────────────────────────

/**
 * Update the teal color fill on the active phrase row.
 *
 * Called every animation frame from the rAF loop in main.ts. The only DOM
 * write is one CSS property change — no layout is triggered.
 *
 * The fill is driven entirely by the playhead position:
 *   - progress 0   → clip-path: inset(0 100% 0 0)  (fully hidden, no teal)
 *   - progress 0.5 → clip-path: inset(0 50% 0 0)   (left half teal)
 *   - progress 1   → clip-path: inset(0 0% 0 0)    (fully revealed)
 *
 * The clamp ensures clean behaviour at the phrase boundaries:
 *   - Before the phrase starts (position < startTime) → no fill.
 *   - After the phrase ends   (position > endTime)    → full fill.
 *   - Seeking backwards resets correctly because progress can go negative
 *     and is clamped to 0.
 *
 * No CSS transition is set on .phrase-colored — a transition would introduce
 * lag between the teal fill and the playhead dot, breaking the sync.
 *
 * @param activeRow — The currently active PhraseRow (top slot).
 * @param position  — Current playback position in milliseconds
 *                    (player.timer.position).
 */
export function updateLyrics(activeRow: PhraseRow, position: number): void {
  const { phrase, coloredLayer } = activeRow;
  if (!coloredLayer) return;

  // progress: 0 at phrase start, 1 at phrase end.
  const progress =
    (position - phrase.startTime) / (phrase.endTime - phrase.startTime);

  // Clamp to [0, 100] to handle positions outside the phrase window.
  const pct = Math.min(Math.max(progress * 100, 0), 100);

  // Clip away the right (100 - pct)% to reveal the teal layer left-to-right.
  coloredLayer.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
}
