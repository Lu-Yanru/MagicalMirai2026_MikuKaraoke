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

// ─── measureCharWidths ────────────────────────────────────────────────────────

/**
 * Measure the rendered pixel width of each character in the phrase using an
 * off-screen probe span. Called once per phrase during initLyrics before the
 * row is inserted into the DOM, so getBoundingClientRect on the actual spans
 * would return zero. The probe span uses the same font properties as the
 * in-game character spans so the measurements are accurate.
 *
 * Returns an array of widths in pixels, parallel to the chars array.
 *
 * @param chars     - The characters whose widths are needed, in order.
 * @param fontSize  - CSS font-size string (e.g. "1.6rem") matching .char-dim.
 * @param fontFamily - CSS font-family string matching .char-dim.
 * @param fontWeight - CSS font-weight string matching .char-dim.
 */
function measureCharWidths(
  chars: string[],
  fontSize: string,
  fontFamily: string,
  fontWeight: string
): number[] {
  // Create a single probe span and reuse it for all characters to minimise
  // DOM operations. The span is off-screen and invisible so it never flashes.
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:fixed;visibility:hidden;white-space:nowrap;padding:0;margin:0;border:0;";
  probe.style.fontSize   = fontSize;
  probe.style.fontFamily = fontFamily;
  probe.style.fontWeight = fontWeight;
  document.body.appendChild(probe);

  const widths = chars.map((ch) => {
    probe.textContent = ch;
    return probe.getBoundingClientRect().width;
  });

  document.body.removeChild(probe);
  return widths;
}

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

    const rowEl = document.createElement("div");
    rowEl.className = "phrase-row";
    row.element = rowEl;

    const textWrap = document.createElement("div");
    textWrap.className = "phrase-text-wrap";

    // ── Collect IChar list for this phrase ───────────────────────────────────
    const chars: IChar[] = [];
    let char: IChar | null = row.phrase.firstChar;
    while (char) {
      if (char.startTime >= row.phrase.endTime) break;
      chars.push(char);
      char = char.next;
    }

    // ── Compute raw time-proportional positions (0–100%) ─────────────────────
    // This is the ideal position for each character: the fraction of the phrase
    // duration that has elapsed by the time the character starts.
    const rawPcts: number[] = chars.map((c) =>
      phraseDuration > 0
        ? ((c.startTime - row.phrase.startTime) / phraseDuration) * 100
        : 0
    );

    // ── Measure each character's pixel width using an off-screen probe ────────
    // Needed to determine whether adjacent characters would overlap.
    // Font properties must match those set on .char-dim / .char-colored in CSS.
    // If the font has not yet loaded these will be fallback-font measurements,
    // which are close enough for collision resolution purposes.
    const charTexts = chars.map((c) => c.text);

    // Read font properties from a temporary element styled with the game's CSS.
    // We cannot read from an actual .char-dim span because none are in the DOM
    // yet, so we create a temporary one, apply the class, measure, and remove.
    const tempSpan = document.createElement("span");
    tempSpan.className = "char-dim";
    document.body.appendChild(tempSpan);
    const cs = getComputedStyle(tempSpan);
    const fontSize   = cs.fontSize;
    const fontFamily = cs.fontFamily;
    const fontWeight = cs.fontWeight;
    document.body.removeChild(tempSpan);

    const charWidthsPx = measureCharWidths(charTexts, fontSize, fontFamily, fontWeight);

    // ── Convert pixel widths to percentage of phrase text wrap width ──────────
    // The text wrap width equals the overlay width minus the 0.8rem margins on
    // each side. We need the actual pixel width to convert charWidthsPx to pct.
    // Since the text wrap is not in the DOM yet, we measure the overlay instead.
    // This is safe because the overlay is always in the DOM after onVideoReady.
    const overlay = document.getElementById("lyric-overlay");
    // 0.8rem margin on each side; convert rem to px using the root font size.
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const marginPx = 0.8 * remPx;
    const containerWidthPx = overlay
      ? overlay.getBoundingClientRect().width - marginPx * 2
      : 600; // fallback if overlay not found

    // Character widths as percentages of the container width.
    const charWidthsPct = charWidthsPx.map((w) => (w / containerWidthPx) * 100);

    // ── Collision resolution pass ─────────────────────────────────────────────
    // Walk characters left to right. If character i's left edge (nudgedPcts[i])
    // is closer to the previous character's right edge than zero, push it
    // rightward just enough to clear the overlap. This preserves left-to-right
    // ordering and general time proportions while eliminating overlaps.
    //
    // "Left edge" of character i = nudgedPcts[i] - charWidthsPct[i] / 2
    // (because transform: translateX(-50%) centres the span on its left value).
    // "Right edge" of character i = nudgedPcts[i] + charWidthsPct[i] / 2
    const nudgedPcts: number[] = [...rawPcts];

    for (let i = 1; i < nudgedPcts.length; i++) {
      const prevRightEdge =
        nudgedPcts[i - 1] + charWidthsPct[i - 1] / 2;
      const currLeftEdge =
        nudgedPcts[i] - charWidthsPct[i] / 2;

      if (currLeftEdge < prevRightEdge) {
        // Overlap detected: push character i rightward so its left edge is
        // exactly at the previous character's right edge (zero gap).
        // A small gap constant (0.3%) can be added here if a minimum gap
        // between characters is preferred.
        nudgedPcts[i] = prevRightEdge + charWidthsPct[i] / 2;
      }
    }

    // ── Overflow rescale pass ─────────────────────────────────────────────────
    // After collision resolution, characters nudged rightward may exceed 100%
    // (the right edge of the container). If the rightmost character's right
    // edge is past 100%, rescale all positions linearly so it fits exactly.
    //
    // The rescale compresses the range [firstLeft, lastRight] to [firstLeft, 100%]
    // so the first character stays anchored and only the rightward excess is
    // compressed. Relative spacing between characters is preserved as closely
    // as possible given the available space.
    const lastIdx = nudgedPcts.length - 1;
    if (lastIdx >= 0) {
      const lastRightEdge = nudgedPcts[lastIdx] + charWidthsPct[lastIdx] / 2;

      if (lastRightEdge > 100) {
        // How much space is available from the first character's left edge to 100%.
        const firstLeftEdge = nudgedPcts[0] - charWidthsPct[0] / 2;
        const availableRange = 100 - firstLeftEdge;

        // How much space the characters currently occupy.
        const usedRange = lastRightEdge - firstLeftEdge;

        // Scale factor: compress used range to fit available range.
        const scale = availableRange / usedRange;

        for (let i = 0; i < nudgedPcts.length; i++) {
          // Rescale each position relative to the first character's left edge.
          nudgedPcts[i] =
            firstLeftEdge +
            (nudgedPcts[i] - firstLeftEdge) * scale;
        }
      }
    }

    // ── Build DOM spans using nudged positions ────────────────────────────────
    const charEntries: CharEntry[] = [];

    for (let i = 0; i < chars.length; i++) {
      const c       = chars[i];
      const leftPct = nudgedPcts[i];

      const dimSpan = document.createElement("span");
      dimSpan.className = "char-dim";
      dimSpan.style.left = `${leftPct}%`;
      dimSpan.textContent = c.text;

      const coloredSpan = document.createElement("span");
      coloredSpan.className = "char-colored";
      coloredSpan.style.left = `${leftPct}%`;
      coloredSpan.textContent = c.text;
      coloredSpan.style.clipPath = "inset(0 100% 0 0)";

      textWrap.appendChild(dimSpan);
      textWrap.appendChild(coloredSpan);

      charEntries.push({
        char: c,
        startPct: leftPct,  // nudged position, used by updateLyrics for nothing
                             // (updateLyrics uses char.startTime directly)
        dimSpan,
        coloredSpan,
      });
    }

    // Store the char entries for this row so updateLyrics() can access them
    // without querying the DOM.
    phraseCharEntries.set(row, charEntries);

    // ── Cue bar ─────────────────────────────────────────────────────────────
    // .bar-track is the visible rounded background strip.
    // .bar-track-inner is an absolutely positioned inner div inset from both
    // ends of the track. Cues and the playhead are children of this inner div,
    // so left: 0% and left: 100% map to the inset edges, not the outer edges.
    // This prevents cues at the phrase start or end from hanging outside the
    // visible bar area.
    const DIRECTION_CHARS: Record<string, string> = {
      up: "↑", down: "↓", left: "←", right: "→",
    };

    const barTrack = document.createElement("div");
    barTrack.className = "bar-track";

    const barInner = document.createElement("div");
    barInner.className = "bar-track-inner";

    for (const cue of row.cues) {
      const cueEl = document.createElement("div");
      cueEl.className = "cue";
      cueEl.style.left = `${cue.barPosition}%`;
      cueEl.textContent = DIRECTION_CHARS[cue.direction] ?? "?";
      cue.element = cueEl;
      barInner.appendChild(cueEl);   // child of inner, not outer
    }

    const playheadEl = document.createElement("div");
    playheadEl.className = "playhead";
    playheadEl.style.left = "0%";
    row.playheadElement = playheadEl;
    barInner.appendChild(playheadEl); // child of inner, not outer

    barTrack.appendChild(barInner);
    rowEl.appendChild(textWrap);
    rowEl.appendChild(barTrack);
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
