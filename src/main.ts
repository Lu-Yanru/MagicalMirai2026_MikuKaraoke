/**
 * main.ts — Application entry point.
 *
 * Responsibilities:
 *   - Instantiate the TextAlive Player and wire its lifecycle callbacks
 *     (onAppReady / onVideoReady / onTimerReady / onPlay / onPause).
 *   - loadSong(): the single "start playing this song from t=0" path, used
 *     both for initial song selection and "Play Again".
 *   - Run the requestAnimationFrame render loop (tick()) that drives lyric
 *     color fill, the cue-bar playhead, beat-driven singer animation, and
 *     phrase advancement.
 *   - Wire the 'scoreupdate' event (dispatched by ScoreManager) to the HUD
 *     and singer state.
 */

import { Player, type IPlayerApp, type IVideo } from "textalive-app-api";
import type { Timer } from "textalive-app-api";

import { initAppHeight, updateAppHeight } from "./app-height";

// Suppress the console-level "Uncaught (in promise) AbortError: ... was
// interrupted by a call to pause()" noise. This comes from inside the SDK's
// own internal play()/pause() handling when autoplay is blocked/interrupted
// by the browser (see onTimerReady's comment) — it's expected in that
// scenario and already handled by tick()'s glitch guard; this only silences
// the otherwise-unhandled rejection so it doesn't read as a real crash.
// Narrowed to the specific play()/pause() interruption pattern (see
// https://developer.chrome.com/blog/play-request-was-interrupted)
window.addEventListener("unhandledrejection", (e) => {
  if (
    e.reason instanceof DOMException &&
    e.reason.name === "AbortError" &&
    /play\(\) request was interrupted/.test(e.reason.message)
  ) {
    e.preventDefault();
  }
});

import { buildSchedule } from "./game/scheduler";
import { ScoreManager } from "./game/scoring";
import { getSingerState } from "./game/singer";
import { SONGS, getCurrentSong, setCurrentSong, type SongDescriptor } from "./game/song";

import { initStartScreen, showStartScreen, hideStartScreen } from "./ui/start-screen";
import {
  initSingerAnimation,
  updateSingerAnimation,
  setSingerLyricState,
} from "./ui/singer-animation";
import {
  debounceRawSignal,
  isPresenceActiveNow,
  resetVocalPresence,
} from "./ui/vocal-presence";
import { armCues, disarmCues } from "./ui/arrows";
import { initLyrics, activatePhrase, updateLyrics } from "./ui/lyrics";

import {
  phraseTopSlot,
  phraseBottomSlot,
  lyricOverlay,
  btnPlay,
  btnPlayImg,
  scoreEl,
  comboEl,
  songTitleEl,
  inputPad,
  directionButtons,
  btnPlayAgain,
  btnMainMenu,
} from "./ui/dom-refs";
import { createLoadingController } from "./ui/loading-controls";
import { initFullscreenToggle } from "./ui/fullscreen";
import { initInputController } from "./ui/input-controller";
import { applySingerExpression } from "./ui/singer-expression";
import { showEndScreen, hideEndScreen } from "./ui/end-screen-render";

import type { PhraseRow, Direction, ScoreState, RatingType, SingerState } from "./types";

import playIcon from "/src/assets/ui/play.png";
import pauseIcon from "/src/assets/ui/pause.png";

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

// Total cue count across all phrases, set once in onVideoReady right after
// buildSchedule() runs. Needed by end-screen-render.ts's showEndScreen() —
// see game/end-screen.ts's getMaxScore() header comment for why max score
// isn't tracked anywhere else.
let totalCueCount = 0;

// True while the player is seeking (scrubbing). The rAF loop skips lyric
// updates during a seek to avoid showing a half-filled clip-path on a
// position that is about to change again.
let isSeeking = false;

// ─── Render loop state ────────────────────────────────────────────────────────

// prevIsPlaying tracks play state so we detect the pause→play transition
// inside the rAF loop without needing an extra onPlay callback.
let prevIsPlaying = false;

// Set to true the moment btnPlay's click handler calls requestPause(), and
// consumed (reset to false) by tick() on the next frame it observes isPlaying
// having gone false. Disambiguates a manual pause from the player stopping
// itself at genuine end-of-track.
let userInitiatedPause = false;

// How many more frames to hold the last known-good position before trusting
// player.timer.position again. Set on every play/resume because the Web Audio
// clock takes a few frames to settle after requestPlay() returns.
let positionCooldownFrames = 0;
const POSITION_COOLDOWN_FRAMES = 25; // ~133ms at 60 fps — imperceptible to the player

// The last position value rendered. Held during cooldown so the playhead
// does not visually jump on play/resume.
let lastRenderedPosition = 0;

// Set by onPlay() whenever playback (re)starts (fresh load OR resume from
// pause). Consumed by tick() once positionCooldownFrames has fully elapsed —
// only then is `position` trustworthy enough to compute correct miss-timeout
// deadlines. Arming directly inside onPlay() used wall-clock setTimeout
// delays against a position that hadn't started advancing yet, causing the
// first phrase's cues to resolve as Miss before the real (delayed-start)
// playhead ever reached them.
let pendingArmOnResume = false;

// Maximum plausible position advance between two consecutive animation
// frames during real playback. Generous enough to never false-positive on
// frame jitter or background-tab throttling, but far smaller than jumping
// to a much later point in the song. A jump beyond this is treated as a
// glitched/corrupted Timer reading (e.g. an autoplay attempt blocked by
// browser policy), not real playback progress.
const MAX_SANE_POSITION_JUMP_MS = 3000;

// Number of consecutive frames (after the play/resume cooldown has fully
// elapsed) the playhead has reported the exact same position while isPlaying
// is supposedly true. Used to detect a silently stalled/blocked play() call
// — e.g. iOS ignoring an autoplay attempt without ever rejecting it with a
// catchable error, leaving onPlay() having already fired (so the SDK thinks
// it's playing, and the Play button reads as "pause") while no real audio
// ever starts and position never moves. This is the opposite failure shape
// from MAX_SANE_POSITION_JUMP_MS above (which catches position jumping too
// FAR forward, not standing still) — both are needed.
let stallFrameCount = 0;
let lastStallCheckPosition = -1;

// ~90 frames is roughly 1.5s at 60fps — long enough that ordinary frame
// jitter or a single dropped frame never false-positives, short enough that
// the player isn't staring at a frozen game for long before recovery fires.
const MAX_STALL_FRAMES = 90;

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

// Tracks whether the end screen has already been shown for this playthrough.
// Needed because tick() detects natural end-of-song by position (position >=
// player.video.endTime), and that condition stays true on every frame after
// the song ends — without this guard showEndScreen() would be called
// repeatedly forever. Reset only happens via location.reload() (the "Play
// again" button), which is fine since this is a one-shot per page load.
let endScreenShown = false;

// ─── Singer state ─────────────────────────────────────────────────────────────
//
// Tracks the singer's current visual state so we only swap the head src and
// trigger the bounce when the state actually changes — not on every scoreupdate.
// Starts as "idle" to match getSingerState() before the first cue resolves.
let currentSingerState: SingerState = "idle";

// ─── Score manager ────────────────────────────────────────────────────────────
// Instantiated once. Handles hit detection, rating, score/combo state.
// Communicates outward via the 'scoreupdate' CustomEvent — no DOM refs inside.
const scoreManager = new ScoreManager();

// True while running inside the TextAlive editor (app.managed). In that mode
// the editor supplies the song itself, so the start screen is skipped
// entirely and the original auto-load/manual-play behavior is preserved.
let isManaged = false;

// True once a song has been loaded and the playback engine has signaled it's
// ready (onTimerReady) at least once this session. requestStop()/requestPlay()
// throw if called before that has ever happened — same underlying lifecycle
// rule as onVideoReady-vs-onTimerReady, just applying to requestStop() too.
let hasPlayableSong = false;

// ─── Loading flag + input-disable wiring ──────────────────────────────────────
// Owns the isLoading flag so this module and input-controller.ts read it
// through the same source of truth instead of each keeping their own copy.
const loadingController = createLoadingController(btnPlay, directionButtons);

// ─── Player instantiation ─────────────────────────────────────────────────────
//
// Player is the single entry point for the TextAlive App API.
// VITE_TEXTALIVE_TOKEN is injected at build time from the environment —
// never committed to the repo.
//
// NOTE: vocalAmplitudeEnabled was tried and removed — getVocalAmplitude() /
// getMaxVocalAmplitude() were confirmed broken in this SDK version (client
// v0.10.0 / server v0.10.1): onVocalAmplitudeLoad fires successfully with a
// real populated data array, but both getters return undefined regardless of
// when they're read afterward. See vocal-presence.ts header comment for the
// full investigation. Singer lyric-presence detection instead uses a
// debounced IPhrase-boundary check (see tick() below).
const player = new Player({
  app: { token: import.meta.env.VITE_TEXTALIVE_TOKEN },
});

// ─── loadSong ─────────────────────────────────────────────────────────────────
//
// Single entry point for "start playing this song from t=0". Used for the
// initial song selection AND for "Play Again" — both want the identical
// reset-and-reload path, so there's exactly one of these rather than two
// near-duplicate code paths.
function loadSong(song: SongDescriptor): void {
  setCurrentSong(song);
  songTitleEl.textContent = song.title;
  // Re-measure the real viewport height right at the start-screen -> game
  // transition. Tapping a song button can leave iOS Safari's toolbar/tab
  // strip mid-resize-animation; relying solely on the 'resize' event risks
  // latching --app-height onto a transient, not-yet-settled value if no
  // further resize event fires once the animation completes.
  updateAppHeight();
  setTimeout(updateAppHeight, 300); // catch a still-settling toolbar animation
  // Only stop a *previous* song — calling requestStop() before any song has
  // ever finished loading (i.e. the very first call, on a fresh page) throws,
  // because the playback engine doesn't exist yet at that point.
  if (hasPlayableSong) {
    userInitiatedPause = true;
    prevIsPlaying = false;
    player.requestStop();
  }
  player.createFromSongUrl(song.songUrl, { video: song.video });
}

// ─── Player lifecycle listeners ───────────────────────────────────────────────
player.addListener({
  // ── onAppReady ───────────────────────────────────────────────────────────
  // Called once the TextAlive App API server connection is established.
  // app.managed is true when running inside the TextAlive editor (it supplies
  // the song URL itself). When false — standalone dev — we load a song manually.
  onAppReady(app: IPlayerApp) {
    isManaged = app.managed;
    if (isManaged) {
      // Running inside the TextAlive editor — it supplies the song itself.
      // Skip the start screen and keep the original auto-load behavior.
      hideStartScreen();
      loadSong(getCurrentSong());
    }
    // Standalone (non-managed): do nothing here. The start screen is visible
    // by default; loadSong() instead fires from the song-select buttons,
    // wired via initStartScreen() near the bottom of this file.
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

    // Reset score state for the new song (covers both a fresh selection and
    // "Play Again" on the same song) — previously nothing ever reset this.
    scoreManager.reset();
    scoreEl.textContent = "0";
    comboEl.textContent = "0x";
    endScreenShown = false;

    // Reset render-loop state that's otherwise only ever initialized once at
    // module load. Without this, values left over from the PREVIOUS song
    // poison tick() for the new one — see investigation note above.
    lastRenderedPosition = 0;
    positionCooldownFrames = 0;
    prevIsPlaying = false;
    userInitiatedPause = false;
    isSeeking = false;
    activePreBlinkIndex = 0;
    activePreBlinkVisible = false;
    pendingArmOnResume = false;
    stallFrameCount = 0;
    lastStallCheckPosition = -1;

    // Build the full cue schedule (one PhraseRow per IPhrase).
    phraseRows = buildSchedule(player);

    // Total cues across the whole song — needed by end-screen-render.ts for
    // max score (totalCueCount × 300, i.e. every cue rated Perfect). Computed
    // once here because cues are mutated (resolved) during play; this count
    // must be captured before that happens, not derived later from state.
    totalCueCount = phraseRows.reduce((sum, row) => sum + row.cues.length, 0);

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

    // Reset lyric-presence debounce state for the new song so no stale
    // active/inactive carryover from a previous song leaks in.
    resetVocalPresence();

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

  onTimerReady(_timer: Timer) {
    hasPlayableSong = true;
    if (!isManaged) {
      player.requestPlay();
    }
    // No-op if startLoading() was never called for this load (managed mode).
    loadingController.finishLoading();
  },

  // Pause/resume lyric updates around seek operations.
  onVideoSeekStart() { isSeeking = true;  },
  onVideoSeekEnd()   { isSeeking = false; },

  // Re-arm miss timeouts when playback resumes. armCues skips already-resolved
  // cues so replaying a partial phrase only arms what hasn't been hit yet.
  onPlay() {
    // Don't arm here — the position isn't stable yet this soon after
    // requestPlay(). Defer to tick(), which arms once positionCooldownFrames
    // confirms the audio clock has actually settled.
    pendingArmOnResume = true;
    btnPlayImg.src = pauseIcon;   // button now shows "pause" while playing
  },

  // Cancel pending miss timeouts while paused so they don't fire against a
  // frozen timer. onPlay() re-arms them on resume.
  onPause() {
    if (phraseRows.length > 0) {
      disarmCues(phraseRows[activeIndex]);
    }
    btnPlayImg.src = playIcon;    // button reverts to "play" while paused
  },
});

player.addListener({
  onAppMediaChange(songUrl: string) {
    console.log("media changed:", songUrl);
  },
});

// ─── Play button ──────────────────────────────────────────────────────────────
btnPlay.addEventListener("click", () => {
  if (loadingController.isLoading()) return;
  if (endScreenShown) return;
  if (player.isPlaying) {
    userInitiatedPause = true;
    prevIsPlaying = true;
    player.requestPause();
  } else {
    userInitiatedPause = false;
    prevIsPlaying = false;
    player.requestPlay();
  }
});

// ─── Fullscreen toggle ──────────────────────────────────────────────────────
initFullscreenToggle();

// ─── Play again button (end screen) ──────────────────────────────────────────
btnPlayAgain.addEventListener("click", () => {
  loadingController.startLoading();
  hideEndScreen();
  loadSong(getCurrentSong());
});

// ─── Main menu button (end screen) ────────────────────────────────────────────
btnMainMenu.addEventListener("click", () => {
  hideEndScreen();
  if (hasPlayableSong) {
    userInitiatedPause = true;
    prevIsPlaying = false;
    player.requestStop();
  }
  showStartScreen();
  // Same reasoning as loadSong() — returning to the start screen is also a
  // tap-driven UI transition that can leave the toolbar mid-resize.
  updateAppHeight();
  setTimeout(updateAppHeight, 300);
});

// ─── Keyboard + touch/click input ──────────────────────────────────────────────
//
// Consolidates the "ignore input if no song loaded yet" check that the
// keyboard and touch paths previously duplicated. lastRenderedPosition is
// passed (not player.timer.position directly) so the timing judgement
// matches what the player sees on screen.
function handleDirectionInput(direction: Direction): void {
  if (phraseRows.length === 0) return;
  scoreManager.handleInput(direction, lastRenderedPosition, phraseRows[activeIndex]);
}

initInputController({
  inputPad,
  directionButtons,
  isLoading: () => loadingController.isLoading(),
  isEndScreenShown: () => endScreenShown,
  onDirection: handleDirectionInput,
});

// ─── HUD + singer update on scoreupdate ──────────────────────────────────────
//
// 'scoreupdate' is dispatched by ScoreManager.applyRating() after every rating.
// The detail is a ScoreState snapshot plus lastRating.
//
// Singer update logic:
//   1. getSingerState() maps score snapshot + lastRating → SingerState string.
//   2. Guard: only act when state changes — avoids redundant src swaps and
//      bounce restarts (e.g. repeated Perfects while already "happy").
//   3. applySingerExpression() decides the head src using BOTH the new state
//      and whether a lyric is currently active (lyricWasActive) — see its
//      doc comment for the full rule.
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

  // ── Natural end-of-song detection ─────────────────────────────────────────
  const nearSongEnd = lastRenderedPosition >= player.video.endTime - 1000;
  if (!endScreenShown && prevIsPlaying && !isPlaying && !userInitiatedPause && nearSongEnd) {
    endScreenShown = true;
    showEndScreen(scoreManager.state, totalCueCount);
    prevIsPlaying = isPlaying;
    return;
  }

  prevIsPlaying = isPlaying;

  if (endScreenShown) return;

  // ── Read position, suppressing stale timer values during cooldown ──────────
  const rawPosition = player.timer.position;
  let position: number;

  // ── Glitch guard: reject an impossible one-frame jump ─────────────────────
  // Must run before any other use of rawPosition this frame — see
  // recoverFromPlaybackGlitch()'s header comment for why this exists.
  if (isPlaying && rawPosition - lastRenderedPosition > MAX_SANE_POSITION_JUMP_MS) {
    recoverFromPlaybackGlitch();
    return;
  }

  if (positionCooldownFrames > 0) {
    positionCooldownFrames--;
    position = lastRenderedPosition; // hold last stable value
  } else {
    position = rawPosition;
    lastRenderedPosition = rawPosition;

    // ── Stall guard: isPlaying reports true but position never advances ──────
    if (isPlaying) {
      if (rawPosition === lastStallCheckPosition) {
        stallFrameCount++;
        if (stallFrameCount >= MAX_STALL_FRAMES) {
          recoverFromPlaybackGlitch();
          return;
        }
      } else {
        stallFrameCount = 0;
        lastStallCheckPosition = rawPosition;
      }
    } else {
      stallFrameCount = 0;
      lastStallCheckPosition = -1;
    }
  }

  // Arm miss-timeouts for the active phrase once the position has fully
  // stabilized since the most recent play/resume.
  if (pendingArmOnResume && positionCooldownFrames === 0 && phraseRows.length > 0) {
    pendingArmOnResume = false;
    armCues(phraseRows[activeIndex], position, (r) => scoreManager.applyRating(r));
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

  // ── Singer lyric state (arm up/down, expression) ──────────────────────────
  // Raw signal: position falls within the active phrase's [startTime, endTime)
  // range. This raw signal alone would flicker the singer's arm down during
  // every short gap between phrases — debounceRawSignal() smooths that out
  // with a hold-time (see vocal-presence.ts header comment for why this is
  // phrase-boundary-based rather than audio-amplitude-based: the amplitude
  // API was tried first and found to be broken in this SDK version).
  const rawLyricActive =
    position >= activeRow.phrase.startTime &&
    position < activeRow.phrase.endTime;

  debounceRawSignal(rawLyricActive, position);
  const lyricActiveNow = isPresenceActiveNow();

  if (lyricActiveNow !== lyricWasActive) {
    lyricWasActive = lyricActiveNow;
    setSingerLyricState(lyricActiveNow);

    // Re-evaluate the head expression for the new lyric-active state, using
    // whatever the score-driven state currently is. This is what makes the
    // singer revert to head_idle.png (or hold head_happy_mouth_big.png if
    // happy) once a genuine instrumental break is detected — independent of
    // any scoreupdate event, which only fires on a rating, not on a phrase
    // boundary.
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

// ─── Tab visibility ───────────────────────────────────────────────────────────
//
// Implements "pause while the tab is inactive" deliberately, rather than
// relying on whatever a backgrounded tab's own browser throttling happens to
// do to audio/rAF — that produced the exact same ambiguous isPlaying-false
// transition tick() uses to detect the song genuinely ending, with no
// reliable way to tell the two apart after the fact.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && hasPlayableSong && player.isPlaying) {
    userInitiatedPause = true;
    prevIsPlaying = false; // same synchronous-with-the-stop pattern as above
    player.requestPause();
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────
initAppHeight();

// Kick off the render loop. Self-scheduling via requestAnimationFrame;
// runs for the lifetime of the page.
tick();

// ─── Start screen wiring ──────────────────────────────────────────────────────
initStartScreen(SONGS, (song) => {
  loadingController.startLoading();
  hideStartScreen();
  loadSong(song);
});

// ─── recoverFromPlaybackGlitch ────────────────────────────────────────────────
//
// Called from tick() when an impossible position jump is detected (see
// MAX_SANE_POSITION_JUMP_MS). Forces playback back to a clean, known-good
// state — same render-loop/phrase-row reset as a fresh song load — so the
// existing (already-working) manual Play button can restart the song
// correctly. Deliberately does NOT call player.requestPlay() again:
// the underlying cause is likely a browser autoplay block, and retrying
// automatically would just glitch again.
function recoverFromPlaybackGlitch(): void {
  console.warn("Playback position glitch detected — resetting to a clean, replayable state.");

  if (hasPlayableSong) {
    player.requestStop(); // pauses AND rewinds the underlying timer to 0
  }

  lastRenderedPosition = 0;
  positionCooldownFrames = 0;
  prevIsPlaying = false;
  userInitiatedPause = true;
  isSeeking = false;
  pendingArmOnResume = false;
  activePreBlinkIndex = 0;
  activePreBlinkVisible = false;
  nextBlinkIndex = 0;
  blinkVisible = false;
  stallFrameCount = 0;
  lastStallCheckPosition = -1;

  activeIndex = 0;
  nextIndex = 1;
  activeIsTop = true;

  if (phraseRows.length > 0) {
    activatePhrase(phraseRows[activeIndex], phraseTopSlot, phraseBottomSlot, true, true);
    if (phraseRows[activeIndex].coloredLayer) {
      phraseRows[activeIndex].coloredLayer!.style.clipPath = "inset(0 100% 0 0)";
    }
    if (phraseRows[activeIndex].playheadElement) {
      phraseRows[activeIndex].playheadElement!.style.left = "calc(-0.8rem - 8px)";
      phraseRows[activeIndex].playheadElement!.style.opacity = "0";
    }
  }
  if (phraseRows.length > 1) {
    activatePhrase(phraseRows[nextIndex], phraseTopSlot, phraseBottomSlot, false, false);
  }

  currentSingerState = "idle";
  lyricWasActive = false;
  applySingerExpression("idle", false);
  setSingerLyricState(false);

  btnPlayImg.src = playIcon;
}
