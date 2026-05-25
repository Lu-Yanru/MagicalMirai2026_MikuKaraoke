/**
 * scheduler.ts — Beat-to-character mapping.
 *
 * Exports a single function, buildSchedule(), that walks the song data loaded
 * by the TextAlive Player and produces a CueEntry[] — one entry per beat that
 * coincides with the start of a new lyric character. The schedule is built once
 * in onVideoReady, before playback starts, and is then consumed by the game
 * loop and scoring system throughout the song.
 */

import type { Player } from "textalive-app-api";
import type { IChar } from "textalive-app-api";
import type { CueEntry, Direction } from "../types";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full cue schedule for the loaded song.
 *
 * Must be called from onVideoReady, after player.video and player.data.songMap
 * are guaranteed to be populated.
 *
 * @param player — The live Player instance from main.ts.
 * @returns      — Ordered array of CueEntry objects, one per matched beat.
 */
export function buildSchedule(player: Player): CueEntry[] {
  // Step 2: Collect all IChar objects from the linked list into a flat array.
  //
  // player.video.firstChar is the head of a singly-linked list of IChar nodes.
  // IChar.next is typed as IChar (not IRenderingUnit) because IChar overrides
  // the property — no cast needed.
  //
  // IVideo.firstChar: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IVideo.html
  // IChar.next:       https://developer.textalive.jp/packages/textalive-app-api/interfaces/IChar.html
  const chars: IChar[] = [];
  let char: IChar = player.video.firstChar;
  while (char) {
    chars.push(char);
    char = char.next;
  }

  // Step 3: Get the beats array from the song map.
  //
  // ISongMap.beats is IBeat[], where each IBeat.startTime is the timestamp in
  // milliseconds at which that beat falls.
  // ISongMap docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/ISongMap.html
  // IBeat docs:    https://developer.textalive.jp/packages/textalive-app-api/interfaces/IBeat.html
  const beats = player.data.songMap.beats;

  // Step 4: For each beat, find the first unassigned char whose startTime falls
  // within ±100ms of the beat timestamp.
  //
  // Design decisions:
  //   - charIndex tracks our position in the chars array so each char is
  //     considered at most once across the entire loop. Because both arrays are
  //     in chronological order, we never need to re-scan from the beginning.
  //   - "Unassigned" is implicit: once charIndex advances past a char it cannot
  //     be matched again, satisfying the "no two entries share the same character"
  //     success criterion.
  //   - A char whose startTime is strictly before (beat.startTime - WINDOW_MS)
  //     has already been passed; we advance charIndex past it and move on.
  //   - A char whose startTime is strictly after (beat.startTime + WINDOW_MS)
  //     is too far in the future for this beat; we leave charIndex where it is
  //     and try the next beat.
  //   - The ±100ms window is the beat-to-character match tolerance specified in
  //     the design doc.
  //   - The Grand Prize song "こたえて" has chorus characters with 1ms duration.
  //     Their startTime values are effectively identical, so they will never fall
  //     within ±100ms of a unique beat and are naturally skipped — no special
  //     handling needed.
  const WINDOW_MS = 100;
  const schedule: CueEntry[] = [];
  let charIndex = 0;

  for (const beat of beats) {
    const beatTime = beat.startTime;

    // Advance past any chars that ended before this beat's window opens.
    while (
      charIndex < chars.length &&
      chars[charIndex].startTime < beatTime - WINDOW_MS
    ) {
      charIndex++;
    }

    // Check whether the next unvisited char falls inside the window.
    if (
      charIndex < chars.length &&
      chars[charIndex].startTime <= beatTime + WINDOW_MS
    ) {
      schedule.push({
        beatTime,
        char: chars[charIndex],
        direction: randomDirection(),
        element: null,
        timeoutId: null,
        resolved: false,
      });
      // Consume this char so it cannot be matched by a subsequent beat.
      charIndex++;
    }
  }

  return schedule;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Step 5: Return one of the four Direction values chosen uniformly at random.
//
// Math.random() produces [0, 1). Multiplying by 4 and flooring gives 0, 1, 2,
// or 3 with equal probability, which we map to the four Direction literals.
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

function randomDirection(): Direction {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}
