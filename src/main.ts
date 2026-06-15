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
import { getSingerState } from "./game/singer";      // Chunk 8 step 3
import { armCues, disarmCues } from "./ui/arrows";
import { initLyrics, activatePhrase, updateLyrics } from "./ui/lyrics";
import type { PhraseRow, Direction, ScoreState, RatingType, SingerState } from "./types";

// ─── DOM references ───────────────────────────────────────────────────────────
//
// Grabbed once at module load time. All getElementById calls are safe here
// because this script is type="module" (deferred) — the DOM is fully parsed
// before any line of this file runs.
//
// #phrase-top and #phrase-bottom are the two fixed slots in #lyric-overlay.
// activatePhrase() swaps phrase row elements in and out of these slots.
const phraseTopSlot    = document.getElementById("phrase-top")    as HTMLElement;
const phraseBottomSlot = document.getElementById("phrase-bottom") as HTMLElement;
const lyricOverlay     = document.getElementById("lyric-overlay") as HTMLElement;
const btnPlay          = document.getElementById("btn-play")      as HTMLButtonElement;
const scoreEl          = document.getElementById("score")         as HTMLElement;
const comboEl          = document.getElementById("combo")         as HTMLElement;

// Chunk 8 step 3: singer image element. src is swapped on each state change.
const singerEl = document.getElementById("singer") as HTMLImageElement;

// ─── Game state ───────────────────────────────────────────────────────────────

// Full ordered list of PhraseRows built by buildSchedule() in onVideoReady.
// Each row wraps one IPhrase with its pre-calculated CueEntry[].
let phraseRows: PhraseRow[] = [];

// Indices into phraseRows for the two visible slots.
//   activeIndex — the phrase currently being sung (full opacity).
//   nextIndex   — the upcoming phrase (dimmed).
// Both are advanced together when the song moves to the next phrase (Chunk 5).
let activeIndex = 0;
let nextIndex   = 1;

// Which physical slot currently holds the active phrase.
//   true  → active phrase is in phraseTopSlot
//   false → active phrase is in phraseBottomSlot
//
// This flag flips on every phrase advance so the active row alternates between
// top and bottom. The slot that just finished becomes the preload slot for the
// phrase after next.
let activeIsTop = true;

// True while the player is seeking (scrubbing). The rAF loop skips lyric
// updates during a seek to avoid showing a half-filled clip-path on a
// position that is about to change again. Cleared by onVideoSeekEnd.
let isSeeking = false;

// ─── Render loop state ─────────────────────────────────────────────────────────
// prevIsPlaying tracks play state so we can detect the pause→play transition
// inside the rAF loop without needing an onPlay callback.
let prevIsPlaying = false;

// How many more frames to hold the last known-good position before trusting
// player.timer.position again. Set to POSITION_COOLDOWN_FRAMES whenever
// playback resumes, because the audio timer takes a few frames to settle
// after requestPlay() returns.
let positionCooldownFrames = 0;
const POSITION_COOLDOWN_FRAMES = 25; // ~133ms at 60fps — imperceptible to user

// The last position value we computed and rendered. Held during cooldown.
let lastRenderedPosition = 0;

// Blink state for the next phrase's waiting playhead.
let nextBlinkIndex = 0;
let blinkVisible = false;

// Blink state for phrase 0's pre-start phase (kept separate from nextBlink*
// so phrase 1's blink state is not corrupted during the intro).
let activePreBlinkIndex = 0;
let activePreBlinkVisible = false;

// ─── Singer state (Chunk 8 step 3) ───────────────────────────────────────────
//
// Tracks the singer's current visual state so we only swap the src and trigger
// the bounce animation when the state actually changes — not on every scoreupdate.
// Starts as "idle" to match getSingerState() before the first cue resolves.
let currentSingerState: SingerState = "idle";

// ─── Score manager ────────────────────────────────────────────────────────────
// Instantiated once. Handles hit detection, rating calculation, and score state.
// Communicates outward via the 'scoreupdate' CustomEvent — no DOM refs inside.
const scoreManager = new ScoreManager();

// ─── Player instantiation ─────────────────────────────────────────────────────
const player = new Player({
  app: { token: import.meta.env.VITE_TEXTALIVE_TOKEN },
});

// ─── Player lifecycle listeners ───────────────────────────────────────────────
player.addListener({
  onAppReady(app: IPlayerApp) {
    if (!app.managed) {
      // こたえて / imie
      player.createFromSongUrl("https://piapro.jp/t/6W2N/20251215164617", {
        video: {
          // 音楽地図訂正履歴
          beatId: 4827293,
          chordId: 2963754,
          repetitiveSegmentId: 3086261,
      
          // 歌詞URL: https://piapro.jp/t/9o24
          // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2F6W2N%2F20251215164617
          lyricId: 126519,
          lyricDiffId: 28645
        },
      });

      // アフター・ザ・カーテン / Rulmry
      // player.createFromSongUrl("https://piapro.jp/t/zoqO/20251214200738", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827294,
      //     chordId: 2963755,
      //     repetitiveSegmentId: 3086262,
      // 
      //     // 歌詞URL: https://piapro.jp/t/EVO2
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FzoqO%2F20251214200738
      //     lyricId: 126591,
      //     lyricDiffId: 28627
      //   },
      // });

      // シャッターチャンス / 夜未アガリ
      // player.createFromSongUrl("https://piapro.jp/t/PNpQ/20251209170719", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827295,
      //     chordId: 2963756,
      //     repetitiveSegmentId: 3086263,
      // 
      //     // 歌詞URL: https://piapro.jp/t/wyWv
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FPNpQ%2F20251209170719
      //     lyricId: 126542,
      //     lyricDiffId: 28628
      //   },
      // });

      // 世界最後の音楽隊 / 夏山よつぎ×ど～ぱみん
      // player.createFromSongUrl("https://piapro.jp/t/B3yJ/20251215061727", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827296,
      //     chordId: 2963757,
      //     repetitiveSegmentId: 3086264,
      // 
      //     // 歌詞URL: https://piapro.jp/t/9U-6
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FB3yJ%2F20251215061727
      //     lyricId: 126594,
      //     lyricDiffId: 28629
      //   },
      // });

      // トリツクロジー / 鶴三
      // player.createFromSongUrl("https://piapro.jp/t/QBdL/20251215094303", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827297,
      //     chordId: 2963758,
      //     repetitiveSegmentId: 3086265,
      // 
      //     // 歌詞URL: https://piapro.jp/t/Nixq
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FQBdL%2F20251215094303
      //     lyricId: 126593,
      //     lyricDiffId: 28630
      //   },
      // });

      // TAKEOVER / Twinfield
      // player.createFromSongUrl("https://piapro.jp/t/E2i3/20251215092113", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827298,
      //     chordId: 2963759,
      //     repetitiveSegmentId: 3086266,
      // 
      //     // 歌詞URL: https://piapro.jp/t/zxWP
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FE2i3%2F20251215092113
      //     lyricId: 126533,
      //     lyricDiffId: 28631
      //   },
      // });
    }
  },

  onVideoReady(_v: IVideo) {
    const beatCount = player.data.songMap.beats.length;
    let charCount = 0;
    let c = player.video.firstChar;
    while (c) { charCount++; c = c.next; }
    console.log(`beats: ${beatCount}, chars: ${charCount}`);

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

    initLyrics(phraseRows);

    activeIndex = 0;
    nextIndex   = 1;
    activeIsTop = true;

    if (phraseRows.length > 0) {
      activatePhrase(phraseRows[activeIndex], phraseTopSlot, phraseBottomSlot, true, true);
    }
    if (phraseRows.length > 1) {
      activatePhrase(phraseRows[nextIndex], phraseTopSlot, phraseBottomSlot, false, false);
    }

    nextBlinkIndex = 0;
    blinkVisible = false;

    if (phraseRows.length > 0 && phraseRows[0].playheadElement) {
      phraseRows[0].playheadElement.style.left    = "calc(-0.8rem - 8px)";
      phraseRows[0].playheadElement.style.opacity = "0";
    }

    if (lyricOverlay) {
      lyricOverlay.classList.remove("hidden");
    }

    // Chunk 8 step 3: reset singer to idle whenever a new song is loaded.
    currentSingerState = "idle";
    singerEl.src = "assets/singer/idle.png";
  },

  onVideoSeekStart() { isSeeking = true;  },
  onVideoSeekEnd()   { isSeeking = false; },

  onPlay() {
    if (phraseRows.length > 0) {
      armCues(phraseRows[activeIndex], player.timer.position, (r) => scoreManager.applyRating(r));
    }
  },

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

// ─── HUD + singer update on scoreupdate (Chunk 7 HUD + Chunk 8 step 3 singer)──
//
// The 'scoreupdate' CustomEvent is dispatched by ScoreManager.applyRating().
// Its detail contains a ScoreState snapshot plus lastRating (added in Chunk 8).
//
// Singer update logic:
//   1. Derive the new state with getSingerState().
//   2. Only act when the state actually changes — avoids re-triggering the
//      bounce animation on every Perfect hit when the singer is already happy.
//   3. Swap the <img> src to the matching PNG in assets/singer/.
//   4. Restart the bounce animation by removing the class, forcing a reflow
//      (void offsetWidth), then re-adding it. Without the reflow, removing
//      and immediately re-adding the same class in one synchronous frame is
//      a no-op and the animation does not restart.
//   5. The 'animationend' listener with { once: true } cleans up the class
//      after the animation completes so it does not linger.

document.addEventListener("scoreupdate", (e) => {
  const detail = (e as CustomEvent<ScoreState & { lastRating: RatingType | null }>).detail;

  // ── HUD update (Chunk 7, unchanged) ──────────────────────────────────────
  scoreEl.textContent = String(detail.score);
  comboEl.textContent = `${detail.combo}x`;

  // ── Singer state update (Chunk 8 step 3) ─────────────────────────────────
  const newSingerState = getSingerState(detail, detail.lastRating);

  if (newSingerState !== currentSingerState) {
    currentSingerState = newSingerState;

    // Swap the singer image source.
    // Asset paths must match the assets/singer/ directory structure.
    singerEl.src = `assets/singer/${newSingerState}.png`;

    // Restart the bounce CSS animation on state change.
    // Removing first prevents the class from being a no-op if still animating.
    singerEl.classList.remove("singer-bounce");
    void singerEl.offsetWidth; // force reflow so removal takes effect before re-add
    singerEl.classList.add("singer-bounce");

    // Auto-remove the class once the animation ends.
    singerEl.addEventListener("animationend", () => {
      singerEl.classList.remove("singer-bounce");
    }, { once: true });
  }
});

// ─── Render loop ──────────────────────────────────────────────────────────────
function tick(): void {
  requestAnimationFrame(tick);

  if (phraseRows.length === 0) return;
  if (isSeeking) return;

  const isPlaying = player.isPlaying;
  if (isPlaying && !prevIsPlaying) {
    positionCooldownFrames = POSITION_COOLDOWN_FRAMES;
  }
  prevIsPlaying = isPlaying;

  const rawPosition = player.timer.position;
  let position: number;

  if (positionCooldownFrames > 0) {
    positionCooldownFrames--;
    position = lastRenderedPosition;
  } else {
    position = rawPosition;
    lastRenderedPosition = rawPosition;
  }

  // ── Phrase advance ────────────────────────────────────────────────────────
  while (
    nextIndex < phraseRows.length &&
    position >= phraseRows[nextIndex].phrase.startTime
  ) {
    activeIndex = nextIndex;
    nextIndex   = activeIndex + 1;

    activeIsTop = !activeIsTop;

    activatePhrase(
      phraseRows[activeIndex],
      phraseTopSlot,
      phraseBottomSlot,
      activeIsTop,
      true
    );

    armCues(phraseRows[activeIndex], position, (r) => scoreManager.applyRating(r));

    const newActive = phraseRows[activeIndex];
    if (newActive.coloredLayer) {
      newActive.coloredLayer.style.clipPath = "inset(0 100% 0 0)";
    }

    if (nextIndex < phraseRows.length) {
      activatePhrase(
        phraseRows[nextIndex],
        phraseTopSlot,
        phraseBottomSlot,
        !activeIsTop,
        false
      );
    } else {
      const emptySlot = activeIsTop ? phraseBottomSlot : phraseTopSlot;
      emptySlot.innerHTML = "";
    }

    nextBlinkIndex = 0;
    blinkVisible = false;

    if (nextIndex < phraseRows.length) {
      const newNextRow = phraseRows[nextIndex];
      if (newNextRow.playheadElement) {
        newNextRow.playheadElement.style.left  = "calc(-0.8rem - 8px)";
        newNextRow.playheadElement.style.opacity = "0";
      }
    }
  }

  const activeRow = phraseRows[activeIndex];

  updateLyrics(activeRow, position);

  // ── Active phrase playhead ────────────────────────────────────────────────
  if (activeRow.playheadElement) {
    if (position < activeRow.phrase.startTime) {
      // PRE-START: phrase 0 intro blink uses its own counters.
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
      // MOVING: phrase has started.
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
    const nextRow = phraseRows[nextIndex];
    const blinkBeats = nextRow.blinkBeats;

    if (nextRow.playheadElement) {
      const phraseStarted = position >= nextRow.phrase.startTime;

      if (phraseStarted) {
        nextRow.playheadElement.style.opacity = "0";
      } else {
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

tick();

// TODO (Chunk 8 steps 4–8): Start screen, end screen, song selection, results.