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
import type { Timer } from "textalive-app-api";

// ─── Viewport height fix (iOS) ────────────────────────────────────────────────
//
// 100dvh is not fully reliable on iOS — there's a confirmed WebKit bug
// (https://bugs.webkit.org/show_bug.cgi?id=261185) where dvh/svh don't
// correctly reflect the real visible height when the Safari tab bar's size
// varies (e.g. landscape with multiple tabs open, as observed). We instead
// read window.visualViewport.height directly — it tracks the actual visible
// pixel height continuously and isn't subject to that bug — and write it to
// a CSS variable that the layout uses instead of vh/dvh.
function updateAppHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

updateAppHeight();
window.visualViewport?.addEventListener("resize", updateAppHeight);
window.addEventListener("resize", updateAppHeight);
window.addEventListener("orientationchange", updateAppHeight);

import { buildSchedule } from "./game/scheduler";
import { ScoreManager } from "./game/scoring";
import { getSingerState } from "./game/singer";
import { SONGS, getCurrentSong, setCurrentSong, type SongDescriptor } from "./game/song";
import { computeEndScreenData } from "./game/end-screen";
import { initStartScreen, showStartScreen, hideStartScreen } from "./ui/start-screen";
import {
  initSingerAnimation,
  updateSingerAnimation,
  setSingerLyricState,
  setSingerExpressionState,
} from "./ui/singer-animation";
import {
  debounceRawSignal,
  isPresenceActiveNow,
  resetVocalPresence,
} from "./ui/vocal-presence";
import { armCues, disarmCues } from "./ui/arrows";
import { initLyrics, activatePhrase, updateLyrics } from "./ui/lyrics";
import { RATING_COLORS } from "./ui/rating";
import type { PhraseRow, Direction, ScoreState, RatingType, SingerState } from "./types";

import playIcon from "/src/assets/ui/play.png";
import pauseIcon from "/src/assets/ui/pause.png";

import headHappyBig from "/src/assets/singer/head_happy_mouth_big.png";
import headIdle from "/src/assets/singer/head_idle.png";
import headSad from "/src/assets/singer/head_sad.png"

import singerHappyImg   from "/src/assets/singer/singer_happy.png";
import singerSingingImg from "/src/assets/singer/singer_singing.png";
import singerIdleImg    from "/src/assets/singer/singer_idle.png";
import singerSadImg     from "/src/assets/singer/singer_sad.png";
import singerAngryImg   from "/src/assets/singer/singer_angry.png";

// Resolves the filename returned by getSingerImageForLetter() (end-screen.ts)
// to its bundled Vite asset URL. A plain Record, not a template-literal path,
// for the same reason ARROW_IMAGES in lyrics.ts uses one: Vite's static
// analysis needs each import written out explicitly to bundle and hash it.
const END_SINGER_IMAGES: Record<string, string> = {
  "singer_happy.png":   singerHappyImg,
  "singer_singing.png": singerSingingImg,
  "singer_idle.png":    singerIdleImg,
  "singer_sad.png":     singerSadImg,
  "singer_angry.png":   singerAngryImg,
};

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
const btnPlayImg = document.getElementById("btn-play-img") as HTMLImageElement;

// ── Singer DOM refs (Chunk 8) ─────────────────────────────────────────────────
//
// singerHead: the topmost layer — head_idle / head_happy / head_singing / head_sad.
//   Only this layer's src is swapped on state change. Body, arms, and pigtails
//   stay on their default src; arm animations will be added in later steps.
const singerHead      = document.getElementById("singer-head")      as HTMLImageElement;

// ── End-screen DOM refs ───────────────────────────────────────────────────────
const songTitleEl = document.getElementById("song-title") as HTMLElement;
const screenEnd      = document.getElementById("screen-end")    as HTMLElement;
const endTitleEl     = document.getElementById("end-title")     as HTMLElement;
const endScoreValueEl = document.getElementById("end-score-value") as HTMLElement;
const endPercentageEl = document.getElementById("end-percentage")  as HTMLElement;
const endLetterEl     = document.getElementById("end-letter")      as HTMLElement;
const endMaxComboEl   = document.getElementById("end-max-combo")   as HTMLElement;
const endSingerImgEl  = document.getElementById("end-singer-img")  as HTMLImageElement;
const btnPlayAgain     = document.getElementById("btn-play-again")  as HTMLButtonElement;
const btnMainMenu      = document.getElementById("btn-main-menu")   as HTMLButtonElement;

// Count <span> + label <span> pairs for each rating tier, keyed the same way
// ScoreState.counts is keyed (RatingType), so showEndScreen() can loop instead
// of repeating five near-identical lines.
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
// buildSchedule() runs. Needed by end-screen.ts's getMaxScore() — see that
// module's header comment for why max score isn't tracked anywhere else.
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

// True while running inside the TextAlive editor (app.managed). In that mode
// the editor supplies the song itself, so the start screen is skipped
// entirely and the original auto-load/manual-play behavior is preserved.
let isManaged = false;

// True once a song has been loaded and the playback engine has signaled it's
// ready (onTimerReady) at least once this session. requestStop()/requestPlay()
// throw if called before that has ever happened — same underlying lifecycle
// rule as onVideoReady-vs-onTimerReady, just applying to requestStop() too.
let hasPlayableSong = false;

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

    // Build the full cue schedule (one PhraseRow per IPhrase).
    phraseRows = buildSchedule(player);

    // Total cues across the whole song — needed by end-screen.ts for max
    // score (totalCueCount × 300, i.e. every cue rated Perfect). Computed
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

  // Show the end screen when the song stops.
  onStop() {
    if (endScreenShown) return;
    endScreenShown = true;
    player.requestPause();
    showEndScreen(scoreManager.state);
  },
});

player.addListener({
  onAppMediaChange(songUrl: string) {
    console.log("media changed:", songUrl);
  },
});

// ─── Play button ──────────────────────────────────────────────────────────────
btnPlay.addEventListener("click", () => {
  if (endScreenShown) return;
  if (player.isPlaying) {
    userInitiatedPause = true;
    player.requestPause();
  } else {
    userInitiatedPause = false;
    player.requestPlay();
  }
});

// ─── Fullscreen toggle ──────────────────────────────────────────────────────
//
// requestFullscreen() must be called from a real user gesture (click/tap) —
// browsers reject it otherwise, so there is no way to force fullscreen
// automatically on page load. iOS Safari additionally doesn't support the
// Fullscreen API for ordinary page content at all (only <video> elements),
// so both buttons are hidden there via feature detection rather than shown and
// silently failing.
//
// Two buttons share this behavior — one in the HUD (visible during
// gameplay), one in the start-screen hint (visible before a song is
// picked) — querySelectorAll over the shared .fullscreen-btn class wires
// both identically instead of duplicating the handler.
const fullscreenButtons =
  document.querySelectorAll<HTMLButtonElement>(".fullscreen-btn");
const fullscreenHint = document.getElementById("fullscreen-hint") as HTMLElement;

if (!document.documentElement.requestFullscreen) {
  fullscreenButtons.forEach((btn) => btn.classList.add("unsupported"));
  fullscreenHint.classList.add("unsupported");
} else {
  fullscreenButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn("Fullscreen request failed:", err);
        });
      }
    });
  });
}

// ─── Play again button (end screen) ──────────────────────────────────────────
btnPlayAgain.addEventListener("click", () => {
  screenEnd.classList.add("hidden");
  loadSong(getCurrentSong());
});

// ─── Main menu button (end screen) ────────────────────────────────────────────
btnMainMenu.addEventListener("click", () => {
  screenEnd.classList.add("hidden");
  if (hasPlayableSong) {
    player.requestStop();
  }
  showStartScreen();
  // Same reasoning as loadSong() — returning to the start screen is also a
  // tap-driven UI transition that can leave the toolbar mid-resize.
  updateAppHeight();
  setTimeout(updateAppHeight, 300);
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
  if (endScreenShown) return;

  const direction = KEY_TO_DIRECTION[e.key];
  if (!direction) return;
  e.preventDefault();

  // Visual sync: press the on-screen button to match the key, regardless of
  // whether a cue is currently active. Done unconditionally (before the
  // empty-phraseRows guard below) so the button still visibly responds even
  // before the song has loaded — matches what a real touch press would do.
  DIRECTION_BUTTONS[direction].classList.add("key-pressed");

  // Browsers auto-repeat keydown while a key is held. Without this guard, a
  // long hold before a cue fires handleInput repeatedly, and a later repeat
  // can land inside the cue's hit window — registering a hit on a held key
  // that was never freshly pressed for that cue. e.repeat is true on every
  // synthetic repeat event and false on the original press.
  if (e.repeat) return;

  // Ignore input if no song is loaded yet or song hasn't started.
  if (phraseRows.length === 0) return;

  scoreManager.handleInput(direction, lastRenderedPosition, phraseRows[activeIndex]);
});

// Release the visual press on keyup. Browsers auto-repeat `keydown` while a
// key is held, but only fire `keyup` once on release — so this naturally
// keeps the button looking pressed for the full hold duration without any
// extra debouncing logic.
document.addEventListener("keyup", (e) => {
  if (endScreenShown) return;

  const direction = KEY_TO_DIRECTION[e.key];
  if (!direction) return;
  DIRECTION_BUTTONS[direction].classList.remove("key-pressed");
});

// ─── Touch / click input ──────────────────────────────────────────────────────
//
// Single delegated listener on #input-pad handles all four buttons.
// touchstart is used for lower latency on mobile. { passive: false } is
// required so e.preventDefault() is allowed — prevents the synthetic click
// that would otherwise fire ~300ms later and double-trigger the input.
const inputPad = document.getElementById("input-pad") as HTMLElement;

// ─── Input pad button refs, keyed by Direction (Chunk: keyboard visual sync) ─
//
// Lets the keyboard handler below toggle the same `.key-pressed` CSS class
// that touch/mouse presses get for free via the native :active pseudo-class,
// so pressing an arrow key visually presses its on-screen button too.
const DIRECTION_BUTTONS: Record<Direction, HTMLButtonElement> = {
  up:    inputPad.querySelector('[data-direction="up"]')    as HTMLButtonElement,
  down:  inputPad.querySelector('[data-direction="down"]')  as HTMLButtonElement,
  left:  inputPad.querySelector('[data-direction="left"]')  as HTMLButtonElement,
  right: inputPad.querySelector('[data-direction="right"]') as HTMLButtonElement,
};

function handlePadInput(target: EventTarget | null): void {
  if (endScreenShown) return;

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
        ? headHappyBig
        : headIdle;
    // Stop any in-progress beat-driven mouth swap bookkeeping so that if a
    // lyric starts again on this same state, the mouth animation resumes
    // cleanly from mouth_small rather than from wherever it left off.
    setSingerExpressionState(state === "happy" ? "happy" : "idle");
    return;
  }

  // Lyric IS active — normal per-state handling.
  if (state === "idle") {
    singerHead.src = headIdle;
  }
  else if (state === "sad") {
    singerHead.src = headSad
  }
  // "happy" / "singing" while a lyric is active: beat-driven mouth animation
  // owns the src from here on, via setSingerExpressionState() + tick().
  setSingerExpressionState(state);
}

// ─── End screen ───────────────────────────────────────────────────────────────
//
// Populates and shows #screen-end from the final ScoreState. Deliberately
// does NOT touch singerHead / singerContainer / the beat-driven animation
// state in singer-animation.ts — the end-screen singer image (right column)
// is a separate static result image (singer_happy.png etc., see end-screen.ts)
// from the live animated gameplay sprite, so the two are fully independent.
//
// computeEndScreenData() (pure, in end-screen.ts) does all the rating math;
// this function only writes the result into the DOM.
function showEndScreen(state: ScoreState): void {
  const data = computeEndScreenData(state, totalCueCount);

  endTitleEl.textContent = getCurrentSong().title;
  endScoreValueEl.textContent = String(data.score);
  endPercentageEl.textContent = `${data.percentage.toFixed(1)}%`;

  endLetterEl.textContent = data.letter;
  endLetterEl.style.color = data.letterColor;

  // Breakdown rows: count + label, label colored to match the in-game
  // rating-pop color for that tier (RATING_COLORS, defined once in rating.ts
  // and imported here rather than re-specified, so the two can never drift
  // apart).
  for (const ratingKey of Object.keys(END_COUNT_ELS) as RatingType[]) {
    END_COUNT_ELS[ratingKey].textContent = String(data.counts[ratingKey]);
    END_LABEL_ELS[ratingKey].style.color = RATING_COLORS[ratingKey];
  }

  endMaxComboEl.textContent = String(data.maxCombo);

  endSingerImgEl.src = END_SINGER_IMAGES[data.singerImageFile];
  endSingerImgEl.alt = `${data.letter} rank`;

  screenEnd.classList.remove("hidden");
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
  if (!endScreenShown && prevIsPlaying && !isPlaying && !userInitiatedPause) {
    endScreenShown = true;
    showEndScreen(scoreManager.state);
    prevIsPlaying = isPlaying;
    return;
  }

  prevIsPlaying = isPlaying;

  if (endScreenShown) return;

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

// Kick off the render loop. Self-scheduling via requestAnimationFrame;
// runs for the lifetime of the page.
tick();

// ─── Start screen wiring ──────────────────────────────────────────────────────
initStartScreen(SONGS, (song) => {
  hideStartScreen();
  loadSong(song);
});
