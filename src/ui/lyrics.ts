/**
 * lyrics.ts — Lyric rendering, phrase display, and per-character color fill.
 *
 * Each character (IChar) in a phrase is rendered as a pair of absolutely
 * positioned spans — one dim, one teal — placed at a horizontal position
 * proportional to the character's start time within the phrase. This means
 * the playhead (which moves linearly by time) reaches each character exactly
 * when it is sung, regardless of whether characters are evenly spaced in time.
 *
 * Color activation is per-character: a character's teal span becomes visible
 * when the playback position passes that character's startTime. While the
 * playhead is inside a character's duration, the teal span uses clip-path to
 * show a partial fill proportional to progress through that character's hold.
 */

import type { IChar } from "textalive-app-api";
import type { PhraseRow } from "../types";

// ─── Internal per-character DOM reference ────────────────────────────────────

/**
 * Stores the two <span> elements created for each IChar so updateLyrics()
 * can update them each frame without querying the DOM.
 *
 * Fields:
 *   char        — The IChar this entry represents.
 *   startPct    — Horizontal position as 0–100% of phrase duration.
 *                 Computed once at init time.
 *   dimSpan     — The always-visible dim span (base layer).
 *   coloredSpan — The teal span, hidden until char.startTime is reached.
 */
interface CharEntry {
  char: IChar;
  startPct: number;
  dimSpan: HTMLSpanElement;
  coloredSpan: HTMLSpanElement;
}

/**
 * Per-phrase list of CharEntry objects, parallel to PhraseRow.
 * Stored in a WeakMap keyed on PhraseRow so no type changes are needed.
 */
const phraseCharEntries = new WeakMap<PhraseRow, CharEntry[]>();

// ─── initLyrics ───────────────────────────────────────────────────────────────

/**
 * Build the DOM element tree for every phrase row and store element references
 * on each PhraseRow. Does NOT attach any rows to the live document.
 *
 * Each phrase is rendered as a container of absolutely positioned character
 * span pairs. The horizontal position of each pair is proportional to the
 * character's start time within the phrase, so the linearly-moving playhead
 * reaches each character at the correct musical moment.
 *
 * @param phraseRows — The full ordered list of PhraseRows built by the scheduler.
 */
export function initLyrics(phraseRows: PhraseRow[]): void {
  for (const row of phraseRows) {
    const phraseDuration = row.phrase.endTime - row.phrase.startTime;

    // ── Phrase row container ────────────────────────────────────────────────
    const rowEl = document.createElement("div");
    rowEl.className = "phrase-row";
    row.element = rowEl;

    // ── Character text wrap ─────────────────────────────────────────────────
    // position: relative makes this the containing block for the absolutely
    // positioned character spans. Height is set to one line-height in CSS.
    const textWrap = document.createElement("div");
    textWrap.className = "phrase-text-wrap";

    // ── Per-character span pairs ────────────────────────────────────────────
    const charEntries: CharEntry[] = [];

    // Walk the IChar linked list for this phrase.
    // IPhrase.firstChar is the head; IChar.next walks to the next character.
    // We check that each character belongs to this phrase by confirming its
    // startTime falls within [phrase.startTime, phrase.endTime).
    let char: IChar | null = row.phrase.firstChar;
    while (char) {
      // Guard: stop if we've walked past this phrase's end time.
      if (char.startTime >= row.phrase.endTime) break;

      // Horizontal position: what fraction of the phrase's total duration
      // has elapsed by the time this character starts?
      // This maps time → horizontal space, so the constant-speed playhead
      // reaches this character at exactly char.startTime.
      const startPct =
        phraseDuration > 0
          ? ((char.startTime - row.phrase.startTime) / phraseDuration) * 100
          : 0;

      // Dim base span — always visible, provides the "unsung" color.
      const dimSpan = document.createElement("span");
      dimSpan.className = "char-dim";
      dimSpan.style.left = `${startPct}%`;
      dimSpan.textContent = char.text;

      // Teal colored span — overlaps the dim span exactly.
      // Hidden initially (opacity 0); revealed when playhead passes startTime.
      // While the playhead is inside this character's duration, clip-path
      // provides a partial fill proportional to progress through the hold.
      const coloredSpan = document.createElement("span");
      coloredSpan.className = "char-colored";
      coloredSpan.style.left = `${startPct}%`;
      coloredSpan.textContent = char.text;
      // Start fully clipped (hidden). updateLyrics() opens this up.
      coloredSpan.style.clipPath = "inset(0 100% 0 0)";

      textWrap.appendChild(dimSpan);
      textWrap.appendChild(coloredSpan);

      charEntries.push({ char, startPct, dimSpan, coloredSpan });

      // IChar.next is typed as IChar (not IRenderingUnit), so no cast needed.
      char = char.next;
    }

    // Store the char entries for this row so updateLyrics() can access them
    // without querying the DOM.
    phraseCharEntries.set(row, charEntries);

    // ── Cue bar ─────────────────────────────────────────────────────────────
    // Unchanged from original: one .cue div per CueEntry, one .playhead div.
    const barTrack = document.createElement("div");
    barTrack.className = "bar-track";

    const DIRECTION_CHARS: Record<string, string> = {
      up: "↑", down: "↓", left: "←", right: "→",
    };

    for (const cue of row.cues) {
      const cueEl = document.createElement("div");
      cueEl.className = "cue";
      cueEl.style.left = `${cue.barPosition}%`;
      cueEl.textContent = DIRECTION_CHARS[cue.direction] ?? "?";
      cue.element = cueEl;
      barTrack.appendChild(cueEl);
    }

    const playheadEl = document.createElement("div");
    playheadEl.className = "playhead";
    playheadEl.style.left = "0%";
    row.playheadElement = playheadEl;
    barTrack.appendChild(playheadEl);

    rowEl.appendChild(textWrap);
    rowEl.appendChild(barTrack);
    // Do NOT append to the document here — activatePhrase() does that.
  }
}

// ─── activatePhrase ───────────────────────────────────────────────────────────
// Unchanged from original — no modifications needed here.

export function activatePhrase(
  row: PhraseRow,
  topSlot: HTMLElement,
  bottomSlot: HTMLElement,
  isTop: boolean,
  isActive: boolean
): void {
  if (!row.element) return;

  const slot = isTop ? topSlot : bottomSlot;
  slot.innerHTML = "";

  row.element.classList.remove("active", "next");
  row.element.classList.add(isActive ? "active" : "next");

  slot.appendChild(row.element);
}

// ─── updateLyrics ─────────────────────────────────────────────────────────────

/**
 * Update the teal color fill on the active phrase row each animation frame.
 *
 * For each character in the phrase:
 *   - If position < char.startTime:          fully hidden (clip 100% from right)
 *   - If position >= char.endTime:           fully revealed (clip 0%)
 *   - If startTime <= position < endTime:    partial fill proportional to
 *                                            progress through the character's hold
 *
 * This means:
 *   - Characters that have already been sung are fully teal.
 *   - The character currently being sung fills progressively as it is held.
 *   - Characters not yet reached remain dim.
 *   - The teal boundary always aligns with the playhead dot, because both are
 *     driven by the same linear time-to-position mapping.
 *
 * @param activeRow — The currently active PhraseRow.
 * @param position  — Current playback position in milliseconds.
 */
export function updateLyrics(activeRow: PhraseRow, position: number): void {
  const entries = phraseCharEntries.get(activeRow);
  if (!entries) return;

  for (const entry of entries) {
    const { char, coloredSpan } = entry;
    const charDuration = char.endTime - char.startTime;

    if (position < char.startTime) {
      // Playhead has not yet reached this character — fully hidden.
      coloredSpan.style.clipPath = "inset(0 100% 0 0)";
    } else if (charDuration <= 0 || position >= char.endTime) {
      // Playhead has passed this character (or it has zero/instant duration)
      // — fully revealed.
      coloredSpan.style.clipPath = "inset(0 0% 0 0)";
    } else {
      // Playhead is inside this character's hold. Reveal proportionally.
      // progress 0 = just started, 1 = just ended.
      const progress = (position - char.startTime) / charDuration;
      const pct = progress * 100;
      // clip-path inset removes from the right, so (100 - pct)% hidden means
      // pct% of the character's span is revealed from the left.
      coloredSpan.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    }
  }
}
