/**
 * scheduler.ts — Beat-based cue schedule builder.
 *
 * Exports buildSchedule(), which walks the song data loaded by the TextAlive
 * Player and produces a PhraseRow[] — one row per IPhrase, each containing the
 * CueEntry[] of beats selected to be arrow cues.
 *
 * Selection algorithm (per phrase):
 *   1. Eligibility filter  — keeps only beats with sufficient lead time from
 *                            phrase start, and excludes the last beat of each
 *                            bar (the "upbeat"), which feels unnatural to press.
 *   2. Density targeting   — determines how many cues to place based on how
 *                            many eligible beats are available. Short phrases
 *                            naturally receive fewer cues without any explicit
 *                            length check.
 *   3. Phase rotation      — cycles through three preferred-position sets every
 *                            PHRASES_PER_PHASE phrases, so cues do not always
 *                            land on the same beat of the bar:
 *                              Phase 0 — downbeat only (position 0)
 *                              Phase 1 — half-bar beat (beat 3 in 4/4)
 *                              Phase 2 — backbeat positions (beat 2 in 4/4)
 *                            If preferred positions yield no candidates, a
 *                            fallback pass selects any eligible beat.
 *   4. Spacing enforcement — no two cues within the same phrase closer than
 *                            MIN_SPACING_MS apart.
 *
 * The schedule is built once in onVideoReady before playback starts, and is
 * then consumed by the lyric UI, game loop, and scoring system.
 */

import type { IBeat, IPhrase, Player } from "textalive-app-api";
import type { CueEntry, Direction, PhraseRow } from "../types";

// ─── Constants ────────────────────────────────────────────────────────────────

// Minimum milliseconds from phrase start before a beat can receive a cue.
// Ensures the player has time to see and react after the phrase bar goes active.
const MIN_REACT_MS = 300;

// Minimum milliseconds between any two cues within the same phrase.
// Prevents cues clustering so tightly that they feel like frantic mashing.
const MIN_SPACING_MS = 150;

// How many consecutive phrases share the same preferred-position pattern before
// rotating to the next phase. 2 = one musical call-and-response pair per phase.
const PHRASES_PER_PHASE = 2;

// Number of distinct selection phases in the rotation cycle.
const PHASE_COUNT = 3;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full cue schedule for the loaded song.
 *
 * Must be called from onVideoReady, after player.video and player.data.songMap
 * are guaranteed to be populated.
 *
 * @param player — The live Player instance from main.ts.
 * @returns      — Ordered array of PhraseRow objects, one per IPhrase.
 *                 Phrases with insufficient eligible beats have an empty cues[].
 */
export function buildSchedule(player: Player): PhraseRow[] {
  // ── Collect all IPhrase objects ───────────────────────────────────────────
  //
  // player.video.firstPhrase is the head of a singly-linked list.
  // IPhrase.next narrows to IPhrase so no cast is needed.
  // IPhrase docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IPhrase.html
  const phrases: IPhrase[] = [];
  let phrase: IPhrase = player.video.firstPhrase;
  while (phrase) {
    phrases.push(phrase);
    phrase = phrase.next;
  }

  // ── Get the beats array from the song map ─────────────────────────────────
  //
  // IBeat.position — 0-based index of this beat within its bar.
  // IBeat.length   — total beats in the bar (time signature numerator).
  // IBeat docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IBeat.html
  const beats: IBeat[] = player.data.songMap.beats;

  // ── Pre-build one PhraseRow per phrase with empty cue arrays ─────────────
  const phraseRows: PhraseRow[] = phrases.map((p) => ({
    phrase: p,
    cues: [],
    element: null,
    coloredLayer: null,
    playheadElement: null,
    blinkBeats: [],
  }));

  // ── Select cues for each phrase ───────────────────────────────────────────
  for (let phraseIndex = 0; phraseIndex < phraseRows.length; phraseIndex++) {
    const row = phraseRows[phraseIndex];
    const phraseStart = row.phrase.startTime;
    const phraseEnd   = row.phrase.endTime;

    // Step 1: All beats that fall strictly within this phrase's time range.
    // beats[] is sorted ascending by startTime; filter preserves that order.
    const phraseBeats = beats.filter(
      (b) => b.startTime >= phraseStart && b.startTime < phraseEnd
    );

    // Step 2: Filter to eligible beats only.
    //
    //   Lead time: beat must start at least MIN_REACT_MS into the phrase so
    //   the player has time to see and react after the bar becomes active.
    //
    //   Not upbeat: the last beat of each bar (position === length - 1) is
    //   anticipatory — it leans into the next downbeat. Pressing it feels
    //   like pressing too early, so we exclude it.
    const eligibleBeats = phraseBeats.filter(
      (b) =>
        b.startTime - phraseStart >= MIN_REACT_MS &&
        b.position !== b.length - 1
    );

    // Step 3: Target cue count based on eligible beat count.
    // Short phrases naturally yield fewer eligible beats (lead-time filter),
    // so they receive fewer cues without any explicit phrase-length check.
    const targetCount = getTargetCount(eligibleBeats.length);
    if (targetCount === 0) continue;

    // Step 4: Determine which beat positions to prefer for this phrase.
    // Use the first eligible beat's bar length as representative for the phrase
    // (time-signature changes mid-phrase are rare enough to ignore).
    const barLength = eligibleBeats[0].length;
    const phase = Math.floor(phraseIndex / PHRASES_PER_PHASE) % PHASE_COUNT;
    const preferredPositions = getPreferredPositions(phase, barLength);

    // Step 5: Select up to targetCount beats, preferring chosen positions and
    // enforcing a minimum gap between any two selected beats.
    const selected = selectBeats(
      eligibleBeats,
      targetCount,
      preferredPositions,
      MIN_SPACING_MS
    );

    // Step 6: Build a CueEntry for each selected beat.
    for (const beat of selected) {
      // barPosition: how far into the phrase this beat falls, as a 0–100 pct.
      const barPosition =
        ((beat.startTime - phraseStart) / (phraseEnd - phraseStart)) * 100;

      const cue: CueEntry = {
        beatTime:    beat.startTime,
        beat,                         // IBeat reference — carries .position, .length
        barPosition,
        direction:   randomDirection(),
        element:     null,
        timeoutId:   null,
        resolved:    false,
      };

      row.cues.push(cue);
    }
  }

  // ── Build blink beat schedule for each phrase ─────────────────────────────
  //
  // blinkBeats[] holds the timestamps of the one bar of beats immediately
  // before each phrase starts. tick() uses these to flash the waiting playhead
  // so the player gets a visual count-in before the phrase goes active.
  for (const row of phraseRows) {
    row.blinkBeats = buildBlinkBeats(row.phrase.startTime, beats);
  }

  return phraseRows;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Target cue count for a phrase based on how many eligible beats it contains.
 *
 * Thresholds chosen so that:
 *   0–1 eligible  — phrase is too short or sparse; skip entirely
 *   2–3 eligible  — 1 cue (manageable for a brief phrase)
 *   4–6 eligible  — 2 cues (standard density)
 *   7+  eligible  — 3 cues (reserved for long phrases)
 */
function getTargetCount(eligibleCount: number): number {
  if (eligibleCount <= 1) return 0;
  if (eligibleCount <= 3) return 1;
  if (eligibleCount <= 6) return 2;
  if (eligibleCount <= 9) return 3;
  if (eligibleCount <= 12) return 4;
  return 5;
}

/**
 * Return the set of beat positions to prefer for this phase.
 *
 * Three phases create three distinct rhythmic feels as they rotate:
 *
 *   Phase 0 — downbeat only (position 0)
 *             Solid, grounding. Cues always land on beat 1 of a bar.
 *
 *   Phase 1 — half-bar beat only (position floor(length/2))
 *             Beat 3 in 4/4, beat 2 in 3/4. Driving, offsets from phase 0.
 *
 *   Phase 2 — backbeat positions (between 0 and floor(length/2), exclusive)
 *             Beat 2 in 4/4. Syncopated feel.
 *             Falls back to [0] for short time signatures (≤ 3/4) where no
 *             positions exist between the downbeat and the half-bar mark.
 *
 * If a phase produces no candidates from eligibleBeats, selectBeats() fills
 * the remaining slots from any eligible beat via its pass-2 fallback.
 *
 * @param phase     — Current rotation phase index (0, 1, or 2).
 * @param barLength — Number of beats in the bar (IBeat.length).
 */
function getPreferredPositions(phase: number, barLength: number): number[] {
  const mid = Math.floor(barLength / 2);

  switch (phase) {
    case 0:
      // Downbeat.
      return [0];

    case 1:
      // Half-bar beat. If mid === 0 (pathological barLength 1), fall back.
      return mid > 0 ? [mid] : [0];

    case 2: {
      // Positions strictly between the downbeat (0) and half-bar (mid).
      // In 4/4: [1] (beat 2). In 6/8: [1, 2]. In 3/4 or 2/4: none → [0].
      const backbeats: number[] = [];
      for (let p = 1; p < mid; p++) backbeats.push(p);
      return backbeats.length > 0 ? backbeats : [0];
    }

    default:
      return [0];
  }
}

/**
 * Select up to targetCount beats from the eligible list.
 *
 * Pass 1 — collect beats whose position is in preferredPositions, respecting
 *           the minimum spacing between any two selected beats.
 * Pass 2 — if still below targetCount, collect any remaining eligible beat
 *           that satisfies the spacing constraint (fallback for sparse phases).
 *
 * Spacing is checked against ALL already-selected beats (not just the most
 * recent), because pass 1 can place beats at non-adjacent time positions,
 * leaving gaps that a pass-2 candidate might fall into.
 *
 * Returns the selected beats sorted ascending by startTime. The sort is needed
 * because pass 2 may insert earlier beats after later ones already selected in
 * pass 1.
 *
 * @param eligible           — Eligible beats for this phrase, in time order.
 * @param targetCount        — Maximum number of beats to select.
 * @param preferredPositions — Beat positions to prioritise in pass 1.
 * @param minSpacingMs       — Minimum gap [ms] between any two selected beats.
 */
function selectBeats(
  eligible: IBeat[],
  targetCount: number,
  preferredPositions: number[],
  minSpacingMs: number
): IBeat[] {
  const selected: IBeat[] = [];
  const selectedSet = new Set<IBeat>();

  // Attempt to add a beat. Silently skips if already selected or too close to
  // any beat already in the selection.
  function tryAdd(beat: IBeat): void {
    if (selectedSet.has(beat)) return;
    const tooClose = selected.some(
      (s) => Math.abs(s.startTime - beat.startTime) < minSpacingMs
    );
    if (!tooClose) {
      selected.push(beat);
      selectedSet.add(beat);
    }
  }

  // Pass 1: preferred positions only.
  for (const beat of eligible) {
    if (selected.length >= targetCount) break;
    if (preferredPositions.includes(beat.position)) tryAdd(beat);
  }

  // Pass 2: fill remaining slots from any eligible beat.
  for (const beat of eligible) {
    if (selected.length >= targetCount) break;
    tryAdd(beat); // tryAdd skips beats already in selectedSet
  }

  // Re-sort ascending by startTime. Pass 2 may have inserted an earlier beat
  // after a later one already chosen by pass 1.
  selected.sort((a, b) => a.startTime - b.startTime);

  return selected;
}

/**
 * Return one of the four Direction values chosen uniformly at random.
 */
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

function randomDirection(): Direction {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

// ─── buildBlinkBeats ──────────────────────────────────────────────────────────

/**
 * Return the beats that form the one complete bar immediately before
 * phraseStartTime. tick() uses these timestamps to flash the waiting playhead,
 * giving the player a visual count-in before the phrase goes active.
 *
 * Strategy:
 *   1. Binary-search for the last beat at or before phraseStartTime.
 *   2. Walk backwards by beat.length steps (one full bar).
 *   3. Return those beats in ascending order.
 *   4. Exclude any beat whose startTime >= phraseStartTime (rule b).
 *   5. If fewer than beat.length beats exist before the phrase, return however
 *      many are available.
 *
 * @param phraseStartTime — The startTime [ms] of the phrase.
 * @param beats           — Full IBeat[] from ISongMap, ascending by startTime.
 */
function buildBlinkBeats(phraseStartTime: number, beats: IBeat[]): IBeat[] {
  if (beats.length === 0) return [];

  // Binary search: last beat whose startTime <= phraseStartTime.
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

  if (anchorIndex < 0) return [];

  // Walk back by one full bar (beat.length steps).
  const barLength = beats[anchorIndex].length;
  const result: IBeat[] = [];

  for (let i = anchorIndex; i >= 0 && result.length < barLength; i--) {
    const beat = beats[i];
    if (beat.startTime >= phraseStartTime) continue; // rule b: stop at phrase start
    result.unshift(beat); // prepend to maintain ascending order
  }

  return result;
}
