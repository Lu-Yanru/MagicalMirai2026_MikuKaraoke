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

import type { IChar, IPhrase, Player } from "textalive-app-api";
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
