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
import type { PhraseRow, Direction } from "../types";

// ─── Cue arrow images ─────────────────────────────────────────────────────────
//
// Hand-drawn 256×256 transparent PNGs (contest rules prohibit AI-generated
// art). Imported as ES modules — not raw string paths — so Vite's static
// analysis can see them, hash them, and copy them into dist/ at build time.
// This mirrors the existing pattern in singer-animation.ts. A template
// literal like `/src/assets/ui/arrow_${direction}.png` would NOT be reliably
// bundled by Vite, so each direction gets its own static import instead.
import arrowUp from "/src/assets/ui/arrow_up.png";
import arrowDown from "/src/assets/ui/arrow_down.png";
import arrowLeft from "/src/assets/ui/arrow_left.png";
import arrowRight from "/src/assets/ui/arrow_right.png";

const ARROW_IMAGES: Record<Direction, string> = {
  up: arrowUp,
  down: arrowDown,
  left: arrowLeft,
  right: arrowRight,
};

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
    // Ideal position for each character: fraction of phrase duration elapsed
    // by the time that character starts.
    const rawPcts: number[] = chars.map((c) =>
      phraseDuration > 0
        ? ((c.startTime - row.phrase.startTime) / phraseDuration) * 100
        : 0
    );

    // ── Measure each character's pixel width using an off-screen probe ────────
    const charTexts = chars.map((c) => c.text);

    const tempSpan = document.createElement("span");
    tempSpan.className = "char-dim";
    document.body.appendChild(tempSpan);
    const cs = getComputedStyle(tempSpan);
    const fontSize   = cs.fontSize;
    const fontFamily = cs.fontFamily;
    const fontWeight = cs.fontWeight;
    document.body.removeChild(tempSpan);

    const charWidthsPx = measureCharWidths(charTexts, fontSize, fontFamily, fontWeight);

    // ── Convert pixel widths to percentage of container width ─────────────────
    const overlay = document.getElementById("lyric-overlay");
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const marginPx = 0.8 * remPx;
    const containerWidthPx = overlay
      ? overlay.getBoundingClientRect().width - marginPx * 2
      : 600;

    const charWidthsPct = charWidthsPx.map((w) => (w / containerWidthPx) * 100);

    // ── Group characters into units by parent IWord ───────────────────────────
    // IChar.parent is the IWord this character belongs to. Characters that
    // share the same IWord object are part of the same word and should be
    // kept together without added spacing between them.
    //
    // For Japanese words (IWord.language === "ja"), each character is its own
    // unit — Japanese characters are positioned individually.
    // For English words (IWord.language === "en"), all characters in the word
    // form one unit — letters stay packed together with no added spacing.
    //
    // Using IWord identity (reference equality) as the grouping key is robust:
    // it handles punctuation, hyphens, mixed scripts, and any edge case the
    // TextAlive API already knows about, without any character classification
    // heuristics on our side.
    interface CharUnit {
      indices: number[];  // indices into chars[] that belong to this unit
      centerPct: number;  // position of the unit center for collision resolution
      widthPct: number;   // total rendered width of the unit as a percentage
    }

    const units: CharUnit[] = [];
    let i = 0;

    while (i < chars.length) {
      const word = chars[i].parent;  // IWord this character belongs to

      if (word.language === "en") {
        // English word: collect all characters that share this exact IWord.
        // Using reference equality (===) so we never accidentally merge
        // characters from two different IWord objects that happen to be
        // adjacent.
        const wordIndices: number[] = [];
        while (i < chars.length && chars[i].parent === word) {
          wordIndices.push(i);
          i++;
        }

        // Total width of the word: sum of all letter widths.
        const wordWidthPct = wordIndices.reduce(
          (sum, idx) => sum + charWidthsPct[idx], 0
        );

        // Anchor the word's left edge at the first letter's raw time position
        // minus half that letter's width (its left edge). The unit center is
        // then the midpoint of the full word width from that left edge.
        const firstIdx    = wordIndices[0];
        const wordLeftEdge = rawPcts[firstIdx] - charWidthsPct[firstIdx] / 2;
        const wordCenterPct = wordLeftEdge + wordWidthPct / 2;

        units.push({
          indices:    wordIndices,
          centerPct:  wordCenterPct,
          widthPct:   wordWidthPct,
        });
      } else {
        // Non-English character (Japanese, symbol, etc.): treat as its own unit.
        units.push({
          indices:   [i],
          centerPct: rawPcts[i],
          widthPct:  charWidthsPct[i],
        });
        i++;
      }
    }

    // ── Collision resolution pass (operates on units) ─────────────────────────
    // Walk units left to right. If a unit's left edge overlaps the previous
    // unit's right edge, push it rightward just enough to clear the overlap.
    const nudgedUnitCenters: number[] = units.map((u) => u.centerPct);

    for (let u = 1; u < units.length; u++) {
      const prevRightEdge = nudgedUnitCenters[u - 1] + units[u - 1].widthPct / 2;
      const currLeftEdge  = nudgedUnitCenters[u]     - units[u].widthPct     / 2;

      if (currLeftEdge < prevRightEdge) {
        nudgedUnitCenters[u] = prevRightEdge + units[u].widthPct / 2;
      }
    }

    // ── Overflow rescale pass ─────────────────────────────────────────────────
    // If the rightmost unit's right edge exceeds 100%, rescale all unit centers
    // linearly so everything fits within the container.
    const lastUnitIdx = units.length - 1;
    if (lastUnitIdx >= 0) {
      const lastRightEdge =
        nudgedUnitCenters[lastUnitIdx] + units[lastUnitIdx].widthPct / 2;

      if (lastRightEdge > 100) {
        const firstLeftEdge  = nudgedUnitCenters[0] - units[0].widthPct / 2;
        const availableRange = 100 - firstLeftEdge;
        const usedRange      = lastRightEdge - firstLeftEdge;
        const scale          = availableRange / usedRange;

        for (let u = 0; u < nudgedUnitCenters.length; u++) {
          nudgedUnitCenters[u] =
            firstLeftEdge + (nudgedUnitCenters[u] - firstLeftEdge) * scale;
        }
      }
    }

    // ── Resolve nudged unit centers back to individual character positions ─────
    // Single-character units: character left% equals unit center.
    // Multi-character English words: pack letters tightly left to right from
    // the unit's nudged left edge, each letter occupying its own measured width.
    const nudgedPcts: number[] = new Array(chars.length);

    for (let u = 0; u < units.length; u++) {
      const unit       = units[u];
      const unitCenter = nudgedUnitCenters[u];
      const unitLeft   = unitCenter - unit.widthPct / 2;

      if (unit.indices.length === 1) {
        // Single character: its center is the unit center.
        nudgedPcts[unit.indices[0]] = unitCenter;
      } else {
        // English word: lay out letters tightly from the left edge.
        // cursor tracks the left edge of the next letter to place.
        let cursor = unitLeft;
        for (const idx of unit.indices) {
          // Centre the letter span on its own midpoint within the word.
          nudgedPcts[idx] = cursor + charWidthsPct[idx] / 2;
          cursor += charWidthsPct[idx];
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
    const barTrack = document.createElement("div");
    barTrack.className = "bar-track";

    const barInner = document.createElement("div");
    barInner.className = "bar-track-inner";

    for (const cue of row.cues) {
      const cueEl = document.createElement("div");
      cueEl.className = "cue";
      cueEl.style.left = `${cue.barPosition}%`;

      // Pre-resolve display: the hand-drawn arrow image for this cue's
      // direction. rating.ts's resolveCue() sets el.textContent on resolve,
      // which DOM-natively clears this <img> child and replaces it with the
      // rating-word text node — no change needed in rating.ts itself.
      const cueImg = document.createElement("img");
      cueImg.className = "cue-arrow-img";
      cueImg.src = ARROW_IMAGES[cue.direction];
      cueImg.alt = "";
      cueEl.appendChild(cueImg);

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
