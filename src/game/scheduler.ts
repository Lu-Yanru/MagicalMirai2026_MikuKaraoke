/**
 * scheduler.ts — Beat-to-character mapping.
 *
 * Exports buildSchedule(), which walks the song data loaded by the TextAlive
 * Player and produces a PhraseRow[] — one row per IPhrase, each containing the
 * CueEntry[] for beats that fall within that phrase's time range.
 *
 * The schedule is built once in onVideoReady before playback starts, and is
 * then consumed by the lyric UI, game loop, and scoring system.
 */

import type { IChar, IBeat, IPhrase, Player } from "textalive-app-api";
import type { CueEntry, Direction, PhraseRow } from "../types";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full cue schedule for the loaded song.
 *
 * Must be called from onVideoReady, after player.video and player.data.songMap
 * are guaranteed to be populated.
 *
 * @param player — The live Player instance from main.ts.
 * @returns      — Ordered array of PhraseRow objects, one per IPhrase.
 *                 Phrases with no matching beats have an empty cues array.
 */
export function buildSchedule(player: Player): PhraseRow[] {
  // ── Step 2: Collect all IChar objects into a flat array ───────────────────
  //
  // player.video.firstChar is the head of a singly-linked list of IChar nodes.
  // IChar.next is typed as IChar (narrows from IRenderingUnit) so no cast is
  // needed when walking.
  //
  // IVideo.firstChar: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IVideo.html
  // IChar.next:       https://developer.textalive.jp/packages/textalive-app-api/interfaces/IChar.html
  const chars: IChar[] = [];
  let char: IChar = player.video.firstChar;
  while (char) {
    chars.push(char);
    char = char.next;
  }

  // ── Step 3: Collect all IPhrase objects into a flat array ─────────────────
  //
  // player.video.firstPhrase is the head of a singly-linked list of IPhrase
  // nodes. IPhrase.next is typed as IPhrase (narrows from IRenderingUnit) so
  // no cast is needed.
  //
  // IPhrase docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IPhrase.html
  const phrases: IPhrase[] = [];
  let phrase: IPhrase = player.video.firstPhrase;
  while (phrase) {
    phrases.push(phrase);
    phrase = phrase.next;
  }

  // ── Step 4: Get the beats array from the song map ─────────────────────────
  //
  // ISongMap.beats is IBeat[], each with a startTime in milliseconds.
  // ISongMap docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/ISongMap.html
  // IBeat docs:    https://developer.textalive.jp/packages/textalive-app-api/interfaces/IBeat.html
  const beats = player.data.songMap.beats;

  // ── Step 5: Match beats to characters ────────────────────────────────────
  //
  // For each beat, find the first unassigned char whose startTime falls within
  // ±WINDOW_MS of the beat timestamp.
  //
  // Both arrays are in chronological order so charIndex only ever advances —
  // O(n + m) rather than O(n * m).
  //
  // "Unassigned" is implicit: once charIndex advances past a char it can never
  // be matched again, so no two cues share the same character.
  //
  // The Grand Prize song "こたえて" has chorus characters with 1ms duration.
  // Their startTime values cluster so tightly that no unique beat falls within
  // ±WINDOW_MS of each one — they are skipped naturally with no special casing.
  const WINDOW_MS = 100;

  // Intermediate: collect raw beat+char matches before grouping by phrase.
  interface Match {
    beatTime: number;
    char: IChar;
  }
  const matches: Match[] = [];
  let charIndex = 0;

  for (const beat of beats) {
    const beatTime = beat.startTime;

    // Advance past chars that have already fallen before this beat's window.
    while (
      charIndex < chars.length &&
      chars[charIndex].startTime < beatTime - WINDOW_MS
    ) {
      charIndex++;
    }

    // Check whether the next unvisited char is within the window.
    if (
      charIndex < chars.length &&
      chars[charIndex].startTime <= beatTime + WINDOW_MS
    ) {
      matches.push({ beatTime, char: chars[charIndex] });
      // Consume this char — it cannot be matched by a subsequent beat.
      charIndex++;
    }
  }

  // ── Steps 6 & 7: Build PhraseRow[], grouping CueEntry[] by phrase ─────────
  //
  // For each match, find which phrase owns that beatTime (startTime <= beatTime
  // < endTime). Calculate barPosition as the beat's percentage position along
  // the phrase's total duration. Assign a random direction.
  //
  // phraseIndex is used as a forward-only cursor over the phrases array.
  // Because both matches and phrases are in chronological order, we never need
  // to scan backwards.
  //
  // Phrases with no matching beats produce a PhraseRow with an empty cues[].
  // They still need a PhraseRow entry so the lyric display can show the phrase
  // text and advance through them correctly.

  // Pre-build a PhraseRow for every phrase, with an empty cues array.
  const phraseRows: PhraseRow[] = phrases.map((p) => ({
    phrase: p,
    cues: [],
    element: null,
    coloredLayer: null,
    playheadElement: null,
    blinkBeats: [],
  }));

  // Build a lookup: for each match, find its owning phrase row by index.
  // phraseRowIndex walks forward only — same O(n + m) pattern as above.
  let phraseRowIndex = 0;

  for (const match of matches) {
    // Advance to the phrase whose time range contains this beat.
    while (
      phraseRowIndex < phraseRows.length - 1 &&
      match.beatTime >= phraseRows[phraseRowIndex].phrase.endTime
    ) {
      phraseRowIndex++;
    }

    const row = phraseRows[phraseRowIndex];

    // Guard: only add the cue if the beat actually falls within this phrase.
    // A beat that falls in a gap between phrases is discarded.
    if (
      match.beatTime < row.phrase.startTime ||
      match.beatTime >= row.phrase.endTime
    ) {
      continue;
    }

    // Step 6: Calculate barPosition (0–100) for this beat within its phrase.
    const barPosition =
      ((match.beatTime - row.phrase.startTime) /
        (row.phrase.endTime - row.phrase.startTime)) *
      100;

    const cue: CueEntry = {
      beatTime: match.beatTime,
      char: match.char,
      barPosition,
      direction: randomDirection(),
      element: null,
      timeoutId: null,
      resolved: false,
    };

    row.cues.push(cue);
  }

  // ── Blink beat schedule ──────────────────────────────────────────────────
  // For each phrase, find the beats in the one bar immediately before the
  // phrase starts. These are the timestamps at which the waiting playhead
  // will flash in tick(), giving the player a count-in before the phrase.
  //
  // We use IBeat.position (0-based index within bar) and IBeat.length (number
  // of beats in the bar) to identify bar boundaries without assuming a fixed
  // time signature, so tempo and time signature changes mid-song are handled.
  for (const row of phraseRows) {
    row.blinkBeats = buildBlinkBeats(row.phrase.startTime, beats);
  }

  return phraseRows;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Step 8: Return one of the four Direction values chosen uniformly at random.
//
// Math.random() produces [0, 1). Multiplying by 4 and flooring gives 0, 1, 2,
// or 3 with equal probability, which we index into the DIRECTIONS array.
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

function randomDirection(): Direction {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

// ─── buildBlinkBeats ──────────────────────────────────────────────────────────

/**
 * Return the beats that form the one complete bar immediately before
 * phraseStartTime. These are used as blink timestamps for the waiting playhead.
 *
 * Strategy:
 *   1. Find the beat whose time range contains phraseStartTime, or the last
 *      beat before it if phraseStartTime falls in a gap.
 *   2. Walk backwards by exactly beat.length steps (one full bar).
 *   3. Collect those beats in ascending order.
 *   4. If fewer than beat.length beats exist before the phrase (song starts
 *      too early), return however many are available (rule: blink for however
 *      many beats are available).
 *   5. Stop collecting if a beat's startTime >= phraseStartTime (rule b:
 *      stop blinking when phrase starts).
 *
 * @param phraseStartTime - The startTime [ms] of the phrase.
 * @param beats           - The full IBeat[] array from ISongMap, in order.
 * @returns               - IBeat[] for the count-in bar, ascending by startTime.
 */
function buildBlinkBeats(phraseStartTime: number, beats: IBeat[]): IBeat[] {
  if (beats.length === 0) return [];

  // ── Step 1: Find the beat at or just before phraseStartTime ───────────────
  // Binary search for the last beat whose startTime <= phraseStartTime.
  // We want the beat the phrase "lands on" or just after.
  let lo = 0;
  let hi = beats.length - 1;
  let anchorIndex = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].startTime <= phraseStartTime) {
      anchorIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // No beat at or before phraseStartTime — nothing to blink.
  if (anchorIndex < 0) return [];

  // ── Step 2: Determine how many beats to walk back (one full bar) ──────────
  // IBeat.length is the number of beats in the bar containing that beat.
  // We use the anchor beat's bar length as the count-in length.
  // If the time signature changes mid-song, each beat carries its own .length,
  // so the bar immediately before the phrase uses the correct value.
  const barLength = beats[anchorIndex].length;

  // ── Step 3: Collect the barLength beats ending at anchorIndex ─────────────
  // Walk backwards from anchorIndex, collecting up to barLength beats.
  // Stop early if we run out of beats (beginning of song).
  const result: IBeat[] = [];

  for (let i = anchorIndex; i >= 0 && result.length < barLength; i--) {
    const beat = beats[i];

    // Rule b: don't include beats that start at or after the phrase start.
    // In practice anchorIndex already satisfies this, but guard explicitly.
    if (beat.startTime >= phraseStartTime) continue;

    result.unshift(beat); // prepend to keep ascending order
  }

  return result;
}
