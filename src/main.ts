/**
 * main.ts — Application entry point.
 *
 * Responsibilities (built up chunk by chunk):
 *   Chunk 2: Instantiate the TextAlive Player and wire lifecycle callbacks.
 *   Chunk 4: Mount the HTML layout.
 *   Chunk 5: Start the requestAnimationFrame render loop.
 *   Chunk 7: Wire keyboard and touch input to the score manager.
 *   Chunk 8: Update singer sprite on score state change (steps 1–3).
 *            Show start / end screens (steps 4–8, TODO).
 */

import { Player, type IPlayerApp, type IVideo } from "textalive-app-api";
import { buildSchedule } from "./game/scheduler";
import { ScoreManager } from "./game/scoring";
import { getSingerState } from "./game/singer";
import {
  initSingerAnimation,
  updateSingerAnimation,
  setSingerLyricState,
  setSingerExpressionState,
} from "./ui/singer-animation";
import { armCues, disarmCues } from "./ui/arrows";
import { initLyrics, activatePhrase, updateLyrics } from "./ui/lyrics";
import type { PhraseRow, Direction, ScoreState, RatingType, SingerState } from "./types";

// ─── DOM references ───────────────────────────────────────────────────────────
//
// Grabbed once at module load time. All getElementById calls are safe here
// because this script is type="module" (deferred) — the DOM is fully parsed
// before any line of this file runs.
const phraseTopSlot    = document.getElementById("phrase-top")    as HTMLElement;
const phraseBottomSlot = document.getElementById("phrase-bottom") as HTMLElement;
const lyricOverlay     = document.getElementById("lyric-overlay") as HTMLElement;
const btnPlay          = document.getElementById("btn-play")      as HTMLButtonElement;
const scoreEl          = document.getElementById("score")         as HTMLElement;
const comboEl          = document.getElementById("combo")         as HTMLElement;

// ── Singer DOM refs (Chunk 8) ─────────────────────────────────────────────────
//
// singerContainer: the <div> wrapping all six layer <img> elements.
//   The bounce animation is applied here so all layers move together as a unit.
//   It carries translateX(-50%) for centering; singerBounce keyframe preserves
//   that translation explicitly alongside the scale.
//
// singerHead: the topmost layer — head_idle / head_happy / head_singing / head_sad.
//   Only this layer's src is swapped on state change. Body, arms, and pigtails
//   stay on their default src; arm animations will be added in later steps.
// const singerContainer = document.getElementById("singer-container") as HTMLElement;
const singerHead      = document.getElementById("singer-head")      as HTMLImageElement;

// ─── Game state ───────────────────────────────────────────────────────────────

// Full ordered list of PhraseRows built by buildSchedule() in onVideoReady.
let phraseRows: PhraseRow[] = [];

// Indices into phraseRows for the two visible slots.
//   activeIndex — the phrase currently being sung (full opacity).
//   nextIndex   — the upcoming phrase (dimmed).
let activeIndex = 0;
let nextIndex   = 1;

// Which physical slot currently holds the active phrase.
//   true  → active phrase is in phraseTopSlot
//   false → active phrase is in phraseBottomSlot
let activeIsTop = true;

// True while the player is seeking (scrubbing). The rAF loop skips lyric
// updates during a seek to avoid showing a half-filled clip-path on a
// position that is about to change again.
let isSeeking = false;

// ─── Render loop state ────────────────────────────────────────────────────────

// prevIsPlaying tracks play state so we detect the pause→play transition
// inside the rAF loop without needing an extra onPlay callback.
let prevIsPlaying = false;

// How many more frames to hold the last known-good position before trusting
// player.timer.position again. Set on every play/resume because the Web Audio
// clock takes a few frames to settle after requestPlay() returns.
let positionCooldownFrames = 0;
const POSITION_COOLDOWN_FRAMES = 25; // ~133ms at 60 fps — imperceptible to the player

// The last position value rendered. Held during cooldown so the playhead
// does not visually jump on play/resume.
let lastRenderedPosition = 0;

// Blink state for the next phrase's waiting playhead.
// Reset to 0 whenever a new phrase becomes "next".
let nextBlinkIndex = 0;
let blinkVisible   = false;

// Blink state for phrase 0's pre-start phase.
// Kept separate from nextBlink* so consuming phrase 0's blink beats does not
// corrupt the blink state that phrase 1 will later use.
let activePreBlinkIndex   = 0;
let activePreBlinkVisible = false;

// Tracks whether a lyric was active on the previous frame, so
// setSingerLyricState() (which swaps the left arm up/down) is only called on
// the true/false transition, not redundantly every frame.
let lyricWasActive = false;

// ─── Singer state (Chunk 8 step 3) ───────────────────────────────────────────
//
// Tracks the singer's current visual state so we only swap the head src and
// trigger the bounce when the state actually changes — not on every scoreupdate.
// Starts as "idle" to match getSingerState() before the first cue resolves.
let currentSingerState: SingerState = "idle";

// ─── Score manager ────────────────────────────────────────────────────────────
// Instantiated once. Handles hit detection, rating, score/combo state.
// Communicates outward via the 'scoreupdate' CustomEvent — no DOM refs inside.
const scoreManager = new ScoreManager();

// ─── Player instantiation ─────────────────────────────────────────────────────
//
// Player is the single entry point for the TextAlive App API.
// VITE_TEXTALIVE_TOKEN is injected at build time from the environment —
// never committed to the repo.
const player = new Player({
  app: { token: import.meta.env.VITE_TEXTALIVE_TOKEN },
});

// ─── Player lifecycle listeners ───────────────────────────────────────────────
player.addListener({
  // ── onAppReady ───────────────────────────────────────────────────────────
  // Called once the TextAlive App API server connection is established.
  // app.managed is true when running inside the TextAlive editor (it supplies
  // the song URL itself). When false — standalone dev — we load a song manually.
  onAppReady(app: IPlayerApp) {
    if (!app.managed) {
      // TAKEOVER / Twinfield
      player.createFromSongUrl("https://piapro.jp/t/E2i3/20251215092113", {
        video: {
          beatId: 4827298,
          chordId: 2963759,
          repetitiveSegmentId: 3086266,
          lyricId: 126533,
          lyricDiffId: 28631
        },
      });
    }
  },

  // ── onVideoReady ─────────────────────────────────────────────────────────
  // Called when the song map and all lyric timing data are fully loaded.
  // Earliest point at which player.data.songMap and player.video are populated.
  onVideoReady(_v: IVideo) {
    const beatCount = player.data.songMap.beats.length;
    let charCount = 0;
    let c = player.video.firstChar;
    while (c) { charCount++; c = c.next; }
    console.log(`beats: ${beatCount}, chars: ${charCount}`);

    // Build the full cue schedule (one PhraseRow per IPhrase).
    phraseRows = buildSchedule(player);
    console.log(
      "schedule:",
      phraseRows.map((row) => ({
        phrase: row.phrase.text,
        startTime: row.phrase.startTime,
        cues: row.cues.map((cue) => ({
          beatTime:    cue.beatTime,
          beatPos:     `${cue.beat.position + 1}/${cue.beat.length}`,
          barPosition: Math.round(cue.barPosition),
          direction:   cue.direction,
        })),
      }))
    );

    // Build all phrase row DOM elements upfront (does not insert into DOM yet).
    initLyrics(phraseRows);

    // Initialize beat-driven singer animations (head shake, pigtail shake,
    // arm swing, mouth) with the full song's beat array. Must come after
    // player.data.songMap.beats is confirmed populated (it is, by this point
    // in onVideoReady).
    initSingerAnimation(player.data.songMap.beats);

    // Activate the first two phrase rows so lyrics are visible before play.
    activeIndex = 0;
    nextIndex   = 1;
    activeIsTop = true;

    if (phraseRows.length > 0) {
      activatePhrase(phraseRows[activeIndex], phraseTopSlot, phraseBottomSlot, true, true);
    }
    if (phraseRows.length > 1) {
      activatePhrase(phraseRows[nextIndex], phraseTopSlot, phraseBottomSlot, false, false);
    }

    // Reset blink state and park phrase 0's playhead in the waiting position.
    nextBlinkIndex = 0;
    blinkVisible   = false;

    if (phraseRows.length > 0 && phraseRows[0].playheadElement) {
      phraseRows[0].playheadElement.style.left    = "calc(-0.8rem - 8px)";
      phraseRows[0].playheadElement.style.opacity = "0";
    }

    // Unhide the lyric overlay now that the first phrases are ready.
    if (lyricOverlay) {
      lyricOverlay.classList.remove("hidden");
    }

    // Reset singer to idle whenever a new song is loaded. No lyric is active
    // yet, so applySingerExpression(idle, false) resolves to head_idle.png —
    // same single rule used everywhere else, not duplicated here.
    currentSingerState = "idle";
    lyricWasActive = false;
    applySingerExpression("idle", false);
    setSingerLyricState(false); // arm_left_down — no phrase active yet
  },

  // Pause/resume lyric updates around seek operations.
  onVideoSeekStart() { isSeeking = true;  },
  onVideoSeekEnd()   { isSeeking = false; },

  // Re-arm miss timeouts when playback resumes. armCues skips already-resolved
  // cues so replaying a partial phrase only arms what hasn't been hit yet.
  onPlay() {
    if (phraseRows.length > 0) {
      armCues(phraseRows[activeIndex], player.timer.position, (r) => scoreManager.applyRating(r));
    }
  },

  // Cancel pending miss timeouts while paused so they don't fire against a
  // frozen timer. onPlay() re-arms them on resume.
  onPause() {
    if (phraseRows.length > 0) {
      disarmCues(phraseRows[activeIndex]);
    }
  },
});

player.addListener({
  onAppMediaChange(songUrl: string) {
    console.log("media changed:", songUrl);
  },
});

// ─── Play button ──────────────────────────────────────────────────────────────
btnPlay.addEventListener("click", () => {
  if (player.isPlaying) {
    player.requestPause();
  } else {
    player.requestPlay();
  }
});

// ─── Keyboard input ───────────────────────────────────────────────────────────
//
// Arrow keys map to the four directions. e.preventDefault() stops the browser
// from scrolling on arrow key presses. We pass lastRenderedPosition so the
// timing judgement matches what the player sees on screen.
const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp:    "up",
  ArrowDown:  "down",
  ArrowLeft:  "left",
  ArrowRight: "right",
};

document.addEventListener("keydown", (e) => {
  const direction = KEY_TO_DIRECTION[e.key];
  if (!direction) return;
  e.preventDefault();
  if (phraseRows.length === 0) return;
  scoreManager.handleInput(direction, lastRenderedPosition, phraseRows[activeIndex]);
});

// ─── Touch / click input ──────────────────────────────────────────────────────
//
// Single delegated listener on #input-pad handles all four buttons.
// touchstart is used for lower latency on mobile. { passive: false } is
// required so e.preventDefault() is allowed — prevents the synthetic click
// that would otherwise fire ~300ms later and double-trigger the input.
const inputPad = document.getElementById("input-pad") as HTMLElement;

function handlePadInput(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement)) return;
  const dir = target.closest("button")?.dataset["direction"] as Direction | undefined;
  if (!dir) return;
  if (phraseRows.length === 0) return;
  scoreManager.handleInput(dir, lastRenderedPosition, phraseRows[activeIndex]);
}

inputPad.addEventListener("touchstart", (e) => {
  e.preventDefault();
  handlePadInput(e.target);
}, { passive: false });

inputPad.addEventListener("click", (e) => {
  handlePadInput(e.target);
});

// ─── Singer expression rule ───────────────────────────────────────────────────
//
// Centralizes the rule for which head image to show, since it now depends on
// TWO independent inputs that change at different times:
//   - currentSingerState (score-driven: idle/happy/singing/sad)
//   - lyricWasActive     (position-driven: is a phrase playing right now)
//
// Rule:
//   No active lyric (instrumental section / before song starts):
//     - state === "happy" → head_happy_mouth_big.png (stays open-mouth happy)
//     - otherwise         → head_idle.png (always reverts to idle)
//   Active lyric:
//     - "idle" / "sad"     → static src set directly by the caller.
//     - "happy" / "singing" → delegated to setSingerExpressionState(), which
//       sets the initial mouth_small frame and hands ongoing beat-driven
//       mouth swaps to updateSingerAnimation() in tick().
//
// Called from two places: the scoreupdate listener (state just changed) and
// the lyric-active transition in tick() (lyric just started/stopped). Both
// sites need the exact same decision, so the rule lives here once.
function applySingerExpression(state: SingerState, lyricActive: boolean): void {
  if (!lyricActive) {
    // No lyric playing — idle by default, except happy holds its open-mouth pose.
    singerHead.src =
      state === "happy"
        ? "/assets/singer/head_happy_mouth_big.png"
        : "/assets/singer/head_idle.png";
    // Stop any in-progress beat-driven mouth swap bookkeeping so that if a
    // lyric starts again on this same state, the mouth animation resumes
    // cleanly from mouth_small rather than from wherever it left off.
    setSingerExpressionState(state === "happy" ? "happy" : "idle");
    return;
  }

  // Lyric IS active — normal per-state handling.
  if (state === "idle" || state === "sad") {
    singerHead.src = `/assets/singer/head_${state}.png`;
  }
  // "happy" / "singing" while a lyric is active: beat-driven mouth animation
  // owns the src from here on, via setSingerExpressionState() + tick().
  setSingerExpressionState(state);
}

// ─── HUD + singer update on scoreupdate ──────────────────────────────────────
//
// 'scoreupdate' is dispatched by ScoreManager.applyRating() after every rating.
// The detail is a ScoreState snapshot plus lastRating (added in Chunk 8).
//
// Singer update logic:
//   1. getSingerState() maps score snapshot + lastRating → SingerState string.
//   2. Guard: only act when state changes — avoids redundant src swaps and
//      bounce restarts (e.g. repeated Perfects while already "happy").
//   3. applySingerExpression() decides the head src using BOTH the new state
//      and whether a lyric is currently active (lyricWasActive) — see its
//      doc comment for the full rule.
//   4. Bounce singerContainer so all six layers animate as one unit.
//      Remove class → force reflow (void offsetWidth) → re-add. Without the
//      reflow, removing and immediately re-adding in one synchronous frame is
//      a no-op and the animation doesn't restart.
//   5. { once: true } animationend listener auto-removes the class.
document.addEventListener("scoreupdate", (e) => {
  const detail = (e as CustomEvent<ScoreState & { lastRating: RatingType | null }>).detail;

  // ── HUD ──────────────────────────────────────────────────────────────────
  scoreEl.textContent = String(detail.score);
  comboEl.textContent = `${detail.combo}x`;

  // ── Singer ────────────────────────────────────────────────────────────────
  const newSingerState = getSingerState(detail, detail.lastRating);

  if (newSingerState !== currentSingerState) {
    currentSingerState = newSingerState;

    applySingerExpression(newSingerState, lyricWasActive);

    // Bounce all layers together via the container.
    // singerContainer.classList.remove("singer-bounce");
    // void singerContainer.offsetWidth; // force reflow
    // singerContainer.classList.add("singer-bounce");
    // singerContainer.addEventListener("animationend", () => {
    //   singerContainer.classList.remove("singer-bounce");
    // }, { once: true });
  }
});

// ─── Render loop ──────────────────────────────────────────────────────────────
//
// requestAnimationFrame fires at the display refresh rate (~60 fps).
// Each frame:
//   1. Detect play/pause transitions and apply position cooldown on resume.
//   2. Read playback position, holding the last stable value during cooldown.
//   3. Advance the active/next phrase indices when the song moves forward.
//   4. Update the teal clip-path color fill on the active phrase.
//   5. Update the active phrase playhead (moving or pre-start blink).
//   6. Update the next phrase playhead (waiting blink).
function tick(): void {
  requestAnimationFrame(tick);

  if (phraseRows.length === 0) return;
  if (isSeeking) return;

  // ── Detect play resumption and start cooldown ─────────────────────────────
  const isPlaying = player.isPlaying;
  if (isPlaying && !prevIsPlaying) {
    positionCooldownFrames = POSITION_COOLDOWN_FRAMES;
  }
  prevIsPlaying = isPlaying;

  // ── Read position, suppressing stale timer values during cooldown ──────────
  const rawPosition = player.timer.position;
  let position: number;

  if (positionCooldownFrames > 0) {
    positionCooldownFrames--;
    position = lastRenderedPosition; // hold last stable value
  } else {
    position = rawPosition;
    lastRenderedPosition = rawPosition;
  }

  // ── Phrase advance ────────────────────────────────────────────────────────
  // Advance as many times as needed (while loop handles the rare case where
  // a seek jumps over multiple phrase boundaries in one frame).
  while (
    nextIndex < phraseRows.length &&
    position >= phraseRows[nextIndex].phrase.startTime
  ) {
    activeIndex = nextIndex;
    nextIndex   = activeIndex + 1;
    activeIsTop = !activeIsTop;

    // Promote the next row to active.
    activatePhrase(
      phraseRows[activeIndex],
      phraseTopSlot,
      phraseBottomSlot,
      activeIsTop,
      true
    );

    // Arm miss timeouts for the newly active phrase.
    armCues(phraseRows[activeIndex], position, (r) => scoreManager.applyRating(r));

    // Reset the clip-path on the new active row so color fill starts clean.
    const newActive = phraseRows[activeIndex];
    if (newActive.coloredLayer) {
      newActive.coloredLayer.style.clipPath = "inset(0 100% 0 0)";
    }

    // Pre-load the phrase after next into the now-free slot (dimmed).
    if (nextIndex < phraseRows.length) {
      activatePhrase(
        phraseRows[nextIndex],
        phraseTopSlot,
        phraseBottomSlot,
        !activeIsTop,
        false
      );
    } else {
      // No more phrases — clear the empty slot.
      const emptySlot = activeIsTop ? phraseBottomSlot : phraseTopSlot;
      emptySlot.innerHTML = "";
    }

    // Reset blink state for the new next phrase.
    nextBlinkIndex = 0;
    blinkVisible   = false;

    // Park the new next phrase's playhead in the waiting position.
    if (nextIndex < phraseRows.length) {
      const newNextRow = phraseRows[nextIndex];
      if (newNextRow.playheadElement) {
        newNextRow.playheadElement.style.left    = "calc(-0.8rem - 8px)";
        newNextRow.playheadElement.style.opacity = "0";
      }
    }
  }

  const activeRow = phraseRows[activeIndex];

  // ── Singer lyric state (arm up/down) ──────────────────────────────────────
  // A lyric is "active" when position falls within the current phrase's
  // [startTime, endTime) range. This also catches instrumental gaps between
  // phrases (position past the previous phrase's endTime but before the next
  // phrase's startTime), which the phrase-advance loop above does not detect
  // on its own since it only fires at phrase-start boundaries.
  const lyricActiveNow =
    position >= activeRow.phrase.startTime &&
    position < activeRow.phrase.endTime;

  if (lyricActiveNow !== lyricWasActive) {
    lyricWasActive = lyricActiveNow;
    setSingerLyricState(lyricActiveNow);

    // Re-evaluate the head expression for the new lyric-active state, using
    // whatever the score-driven state currently is. This is what makes the
    // singer revert to head_idle.png (or hold head_happy_mouth_big.png if
    // happy) the instant a phrase ends — independent of any scoreupdate
    // event, which only fires on a rating, not on a phrase boundary.
    applySingerExpression(currentSingerState, lyricActiveNow);
  }

  // ── Beat-driven singer animations ─────────────────────────────────────────
  // Head shake, pigtail shake, arm swing, and mouth animation all derive from
  // the current position and the full song beat array (set once in
  // initSingerAnimation). isPlaying gates the animation so it freezes cleanly
  // on pause rather than continuing with a stale position.
  updateSingerAnimation(position, isPlaying);

  // ── Lyric color fill ──────────────────────────────────────────────────────
  updateLyrics(activeRow, position);

  // ── Active phrase playhead ────────────────────────────────────────────────
  if (activeRow.playheadElement) {
    if (position < activeRow.phrase.startTime) {
      // PRE-START: phrase 0 during the intro. Uses its own blink counters so
      // it doesn't corrupt the nextBlink* state owned by phrase 1.
      activeRow.playheadElement.style.left = "calc(-0.8rem - 8px)";

      while (
        activePreBlinkIndex < activeRow.blinkBeats.length &&
        position >= activeRow.blinkBeats[activePreBlinkIndex].startTime
      ) {
        activePreBlinkVisible = !activePreBlinkVisible;
        activePreBlinkIndex++;
      }

      activeRow.playheadElement.style.opacity = activePreBlinkVisible ? "1" : "0";
    } else {
      // MOVING: phrase has started — slide playhead left → right.
      const progress =
        (position - activeRow.phrase.startTime) /
        (activeRow.phrase.endTime - activeRow.phrase.startTime);
      const pct = Math.min(Math.max(progress * 100, 0), 100);
      activeRow.playheadElement.style.left    = `${pct}%`;
      activeRow.playheadElement.style.opacity = "1";
    }
  }

  // ── Next phrase waiting/blink playhead ────────────────────────────────────
  if (nextIndex < phraseRows.length) {
    const nextRow    = phraseRows[nextIndex];
    const blinkBeats = nextRow.blinkBeats;

    if (nextRow.playheadElement) {
      const phraseStarted = position >= nextRow.phrase.startTime;

      if (phraseStarted) {
        // The phrase-advance loop above promoted this row on the same frame.
        // Hide the waiting playhead — the active branch now owns it.
        nextRow.playheadElement.style.opacity = "0";
      } else {
        // WAITING: park just left of the bar and blink on beat timestamps.
        nextRow.playheadElement.style.left = "calc(-0.8rem - 8px)";

        while (
          nextBlinkIndex < blinkBeats.length &&
          position >= blinkBeats[nextBlinkIndex].startTime
        ) {
          blinkVisible = !blinkVisible;
          nextBlinkIndex++;
        }

        nextRow.playheadElement.style.opacity = blinkVisible ? "1" : "0";
      }
    }
  }
}

// Kick off the render loop. Self-scheduling via requestAnimationFrame;
// runs for the lifetime of the page.
tick();

// TODO (Chunk 8 steps 4–8): Start screen, end screen, song selection, results.
