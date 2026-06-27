/**
 * end-screen-render.ts — Populates and shows/hides the #screen-end overlay.
 *
 * Deliberately does NOT touch singerHead / the beat-driven animation state
 * in singer-animation.ts — the end-screen singer image (right column) is a
 * separate static result image (singer_happy.png etc., see game/end-screen.ts)
 * from the live animated gameplay sprite, so the two are fully independent.
 *
 * computeEndScreenData() (pure, in game/end-screen.ts) does all the rating
 * math; this module only writes the result into the DOM.
 */

import { computeEndScreenData } from "../game/end-screen";
import { getHighscore, saveHighscoreIfBetter } from "../game/highscore";
import { getCurrentSong } from "../game/song";
import { RATING_COLORS } from "./rating";
import type { RatingType, ScoreState } from "../types";

import singerHappyImg   from "/src/assets/singer/singer_happy.png";
import singerSingingImg from "/src/assets/singer/singer_singing.png";
import singerIdleImg    from "/src/assets/singer/singer_idle.png";
import singerSadImg     from "/src/assets/singer/singer_sad.png";
import singerAngryImg   from "/src/assets/singer/singer_angry.png";

// Resolves the filename returned by getSingerImageForLetter() (game/end-screen.ts)
// to its bundled Vite asset URL. A plain Record, not a template-literal
// path, for the same reason ARROW_IMAGES in lyrics.ts uses one: Vite's
// static analysis needs each import written out explicitly to bundle and
// hash it.
const END_SINGER_IMAGES: Record<string, string> = {
  "singer_happy.png":   singerHappyImg,
  "singer_singing.png": singerSingingImg,
  "singer_idle.png":    singerIdleImg,
  "singer_sad.png":     singerSadImg,
  "singer_angry.png":   singerAngryImg,
};

const screenEnd       = document.getElementById("screen-end")       as HTMLElement;
const endTitleEl      = document.getElementById("end-title")        as HTMLElement;
const endScoreValueEl = document.getElementById("end-score-value")  as HTMLElement;
const endPercentageEl = document.getElementById("end-percentage")   as HTMLElement;
const endLetterEl     = document.getElementById("end-letter")       as HTMLElement;
const endMaxComboEl   = document.getElementById("end-max-combo")    as HTMLElement;
const endHighscoreEl  = document.getElementById("end-highscore")    as HTMLElement;
const endNewRecordEl  = document.getElementById("end-new-record")   as HTMLElement;
const endSingerImgEl  = document.getElementById("end-singer-img")   as HTMLImageElement;

// Count <span> + label <span> pairs for each rating tier, keyed the same way
// ScoreState.counts is keyed (RatingType), so showEndScreen() can loop
// instead of repeating five near-identical lines.
const END_COUNT_ELS: Record<RatingType, HTMLElement> = {
  Perfect: document.getElementById("end-count-perfect") as HTMLElement,
  Great:   document.getElementById("end-count-great")   as HTMLElement,
  Good:    document.getElementById("end-count-good")    as HTMLElement,
  Bad:     document.getElementById("end-count-bad")     as HTMLElement,
  Miss:    document.getElementById("end-count-miss")    as HTMLElement,
};

const END_LABEL_ELS: Record<RatingType, HTMLElement> = {
  Perfect: document.getElementById("end-label-perfect") as HTMLElement,
  Great:   document.getElementById("end-label-great")   as HTMLElement,
  Good:    document.getElementById("end-label-good")    as HTMLElement,
  Bad:     document.getElementById("end-label-bad")     as HTMLElement,
  Miss:    document.getElementById("end-label-miss")    as HTMLElement,
};

/**
 * Populate and show #screen-end from the final ScoreState.
 *
 * NOTE: totalCueCount is now an explicit parameter — the original in-main.ts
 * version read it from main.ts's closure. Same value, just passed in rather
 * than captured.
 *
 * @param state         — Final ScoreState snapshot (score, combo, counts).
 * @param totalCueCount — Total cues across the song, for max-score math
 *                        (see game/end-screen.ts's getMaxScore() header comment).
 */
export function showEndScreen(state: ScoreState, totalCueCount: number): void {
  const data = computeEndScreenData(state, totalCueCount);

  endTitleEl.textContent = getCurrentSong().title;
  endScoreValueEl.textContent = String(data.score);
  endPercentageEl.textContent = `${data.percentage.toFixed(1)}%`;

  endLetterEl.textContent = data.letter;
  endLetterEl.style.color = data.letterColor;

  // ── High score (local, per-browser — see game/highscore.ts header) ───────
  // Save first so getHighscore() below reflects this run if it's a new best.
  const songId = getCurrentSong().id;
  const isNewRecord = saveHighscoreIfBetter(songId, state.score);
  endHighscoreEl.textContent = `High Score: ${getHighscore(songId)}`;
  endNewRecordEl.classList.toggle("hidden", !isNewRecord);

  // Breakdown rows: count + label, label colored to match the in-game
  // rating-pop color for that tier (RATING_COLORS, defined once in
  // rating.ts and imported here rather than re-specified, so the two can
  // never drift apart).
  for (const ratingKey of Object.keys(END_COUNT_ELS) as RatingType[]) {
    END_COUNT_ELS[ratingKey].textContent = String(data.counts[ratingKey]);
    END_LABEL_ELS[ratingKey].style.color = RATING_COLORS[ratingKey];
  }

  endMaxComboEl.textContent = String(data.maxCombo);

  endSingerImgEl.src = END_SINGER_IMAGES[data.singerImageFile];
  endSingerImgEl.alt = `${data.letter} rank`;

  screenEnd.classList.remove("hidden");
}

/** Hide #screen-end (e.g. before loading the next song). */
export function hideEndScreen(): void {
  screenEnd.classList.add("hidden");
}
