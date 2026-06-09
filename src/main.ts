/**
 * main.ts — Application entry point.
 *
 * Responsibilities (built up chunk by chunk):
 *   Chunk 2: Instantiate the TextAlive Player and wire lifecycle callbacks.
 *   Chunk 4: Mount the HTML layout.
 *   Chunk 5: Start the requestAnimationFrame render loop.
 *   Chunk 7: Wire keyboard and touch input to the score manager.
 *   Chunk 8: Show start / end screens; update singer sprite.
 */

import { Player, type IPlayerApp, type IVideo } from "textalive-app-api";
import { buildSchedule } from "./game/scheduler";
import { initLyrics, activatePhrase, updateLyrics, applyLetterSpacing } from "./ui/lyrics";
import type { PhraseRow } from "./types";

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
// Required when using player.timer.position — see:
// https://developer.textalive.jp/packages/textalive-app-api/interfaces/Timer.html#position
let isSeeking = false;

// ─── Render loop state ─────────────────────────────────────────────────────────
// prevIsPlaying tracks play state so we can detect the pause→play transition
// inside the rAF loop without needing an onPlay callback.
let prevIsPlaying = false;

// How many more frames to hold the last known-good position before trusting
// player.timer.position again. Set to POSITION_COOLDOWN_FRAMES whenever
// playback resumes, because the audio timer takes a few frames to settle
// after requestPlay() returns. Without this guard, the timer briefly reports
// a stale position that makes the playhead visually jump.
let positionCooldownFrames = 0;
const POSITION_COOLDOWN_FRAMES = 30; // ~133ms at 60fps — imperceptible to user

// The last position value we computed and rendered. Held during cooldown.
let lastRenderedPosition = 0;

// ─── Player instantiation ─────────────────────────────────────────────────────
//
// Player is the single entry point for the TextAlive App API.
// Docs: https://developer.textalive.jp/packages/textalive-app-api/classes/Player.html
//
// The `app` option marks this as a lyric app and supplies the developer token.
// When `app` is present the Player will also:
//   - parse the page's query string for an initial song URL (useful when the
//     app is embedded inside the TextAlive editor), and
//   - attempt to connect to an app host if one is available.
//
// VITE_TEXTALIVE_TOKEN is injected at build time by Vite from the environment.
// In local development it comes from a .env.local file or a Codespace secret.
// In CI it comes from the VITE_TEXTALIVE_TOKEN GitHub Actions secret.
// The token is never committed to the repository.
//
// PlayerAppOptions.token is a required (non-optional) field.
// Docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/PlayerAppOptions.html
const player = new Player({
  app: { token: import.meta.env.VITE_TEXTALIVE_TOKEN },
});

// ─── Player lifecycle listeners ───────────────────────────────────────────────
//
// player.addListener() accepts a single object that may implement any
// combination of PlayerAppListener and PlayerEventListener callbacks.
// All callbacks are optional; only the ones provided here are called.
//
// Listener interface docs:
//   PlayerAppListener:   https://developer.textalive.jp/packages/textalive-app-api/interfaces/PlayerAppListener.html
//   PlayerEventListener: https://developer.textalive.jp/packages/textalive-app-api/interfaces/PlayerEventListener.html
player.addListener({
  // ── onAppReady ─────────────────────────────────────────────────────────────
  // Called once the TextAlive App API server connection is established and the
  // player is ready to accept song loading commands.
  //
  // app.managed is true when this app is running inside the TextAlive editor or
  // another host that will supply a song URL itself (via onAppMediaChange).
  // When managed is false — i.e. standalone local development — we must call
  // createFromSongUrl ourselves to load a song.
  //
  // IPlayerApp docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IPlayerApp.html
  onAppReady(app: IPlayerApp) {
    if (!app.managed) {
      // Load one of the six designated contest songs.
      // The versioned piapro URLs and revision IDs below must be copied exactly
      // from the contest support page:
      //   https://developer.textalive.jp/events/magicalmirai2026/
      //
      // こたえて / imie
      // player.createFromSongUrl("https://piapro.jp/t/6W2N/20251215164617", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827293,
      //     chordId: 2963754,
      //     repetitiveSegmentId: 3086261,
      
      //     // 歌詞URL: https://piapro.jp/t/9o24
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2F6W2N%2F20251215164617
      //     lyricId: 126519,
      //     lyricDiffId: 28645
      //   },
      // });

      // アフター・ザ・カーテン / Rulmry
      // player.createFromSongUrl("https://piapro.jp/t/zoqO/20251214200738", {
      //   video: {
      //     // 音楽地図訂正履歴
      //     beatId: 4827294,
      //     chordId: 2963755,
      //     repetitiveSegmentId: 3086262,
      
      //     // 歌詞URL: https://piapro.jp/t/EVO2
      //     // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FzoqO%2F20251214200738
      //     lyricId: 126591,
      //     lyricDiffId: 28627
      //   },
      // });

      // シャッターチャンス / 夜未アガリ
      player.createFromSongUrl("https://piapro.jp/t/PNpQ/20251209170719", {
        video: {
          // 音楽地図訂正履歴
          beatId: 4827295,
          chordId: 2963756,
          repetitiveSegmentId: 3086263,
      
          // 歌詞URL: https://piapro.jp/t/wyWv
          // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FPNpQ%2F20251209170719
          lyricId: 126542,
          lyricDiffId: 28628
        },
      });

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

  // ── onVideoReady ───────────────────────────────────────────────────────────
  // Called when the song map and all lyric timing data have been fully loaded
  // and the IVideo object is ready to query.
  //
  // This is the earliest point at which player.data.songMap and player.video
  // are guaranteed to be populated. All data-dependent setup (scheduler,
  // lyric DOM construction, etc.) must happen here or later.
  //
  // The IVideo parameter `v` is the same object as player.video.
  // IVideo docs: https://developer.textalive.jp/packages/textalive-app-api/interfaces/IVideo.html
  onVideoReady(_v: IVideo) {
    // Chunk 2 Step 4: Log beat and character counts to verify data is loaded.
    const beatCount = player.data.songMap.beats.length;
    let charCount = 0;
    let c = player.video.firstChar;
    while (c) { charCount++; c = c.next; }
    console.log(`beats: ${beatCount}, chars: ${charCount}`);

    // Chunk 3: Build the cue schedule grouped by phrase.
    phraseRows = buildSchedule(player);
    console.log(
      "schedule:",
      phraseRows.map((row) => ({
        phrase: row.phrase.text,
        startTime: row.phrase.startTime,
        cues: row.cues.map((cue) => ({
          beatTime: cue.beatTime,
          char: cue.char.text,
          barPosition: Math.round(cue.barPosition),
          direction: cue.direction,
        })),
      }))
    );

    // Chunk 5 Step 4: Build all phrase row DOM elements upfront.
    // initLyrics creates the <div> tree for every phrase row and stores
    // element references on each PhraseRow — but does not insert anything
    // into the live document yet.
    initLyrics(phraseRows);

    // Activate the first two phrase rows immediately so lyrics are visible
    // as soon as the song is ready to play.
    // Guard against songs with fewer than 2 phrases (edge case).
    activeIndex = 0;
    nextIndex   = 1;
    activeIsTop = true;

    if (phraseRows.length > 0) {
      activatePhrase(phraseRows[activeIndex], phraseTopSlot, phraseBottomSlot, true, true);
      // Stretch row 0's text to fill the container so the clip-path
      // percentage correctly maps to a fraction of the visible text.
      applyLetterSpacing(phraseRows[activeIndex]);
    }
    if (phraseRows.length > 1) {
      activatePhrase(phraseRows[nextIndex], phraseTopSlot, phraseBottomSlot, false, false);
      // Same for the next (dimmed) row — its letter-spacing must be set now
      // so it's already correct when it becomes the active row later.
      applyLetterSpacing(phraseRows[nextIndex]);
    }

    // Unhide the lyric overlay only after the first phrases are ready.
    if (lyricOverlay) {
      lyricOverlay.classList.remove("hidden");
    }
  },

  // ── Seek event handlers ────────────────────────────────────────────────────
  // Pause and resume lyric updates around seek operations.
  // Required when reading player.timer.position in a rAF loop — the Timer
  // docs state that apps must handle these events to respond correctly to
  // video seeking.
  // https://developer.textalive.jp/packages/textalive-app-api/interfaces/Timer.html#position
  onVideoSeekStart() { isSeeking = true;  },
  onVideoSeekEnd()   { isSeeking = false; },
});

// ─── onAppMediaChange listener ────────────────────────────────────────────────
//
// Called when the song URL is changed by the TextAlive host (e.g. the editor
// switches tracks). Logging here confirms the full app lifecycle is wired:
// onAppReady → song loads → onVideoReady → onAppMediaChange on track switch.
//
// onAppMediaChange is on PlayerAppListener — confirmed at:
// https://developer.textalive.jp/packages/textalive-app-api/interfaces/PlayerAppListener.html
player.addListener({
  onAppMediaChange(songUrl: string) {
    console.log("media changed:", songUrl);
  },
});

// ─── Temporary playback control (Chunk 2) ────────────────────────────────────
//
// Browsers block autoplay, so song loading can only be triggered by a user
// gesture. This button provides that gesture for testing purposes.
// It will be replaced by the start screen in Chunk 8.
//
// player.isPlaying is a boolean accessor on IPlayer — confirmed at:
// https://developer.textalive.jp/packages/textalive-app-api/interfaces/IPlayer.html
btnPlay.addEventListener("click", () => {
  if (player.isPlaying) {
    player.requestPause();
  } else {
    player.requestPlay();
  }
});

// ─── Render loop ──────────────────────────────────────────────────────────────
//
// requestAnimationFrame fires at the display refresh rate (typically 60 fps).
// Each frame:
//   1. Read the current playback position from player.timer.position — the most
//      precise position source per the Timer docs.
//   2. Update the teal color fill and playhead dot on the active phrase row.
//   3. Check whether the song has advanced past the next phrase's startTime.
//      If so, flip which slot is active, promote the next row, and preload the
//      phrase after that into the newly-freed slot.
//
// The active row alternates between phraseTopSlot and phraseBottomSlot on each
// advance, tracked by activeIsTop. This gives the appearance of an infinite
// scrolling karaoke display using only two fixed DOM slots.
function tick(): void {
  requestAnimationFrame(tick);

  if (phraseRows.length === 0) return;
  if (isSeeking) return;

  // ── Detect play resumption and start cooldown ────────────────────────────
  // player.isPlaying flips to true synchronously when requestPlay() is
  // accepted, but player.timer.position may still be stale for several frames.
  // We freeze the displayed position at its last known-good value and let the
  // audio timer settle before reading it again.
  const isPlaying = player.isPlaying;
  if (isPlaying && !prevIsPlaying) {
    // Just transitioned from paused → playing. Start the cooldown.
    positionCooldownFrames = POSITION_COOLDOWN_FRAMES;
  }
  prevIsPlaying = isPlaying;

  // ── Read position, suppressing stale timer values during cooldown ─────────
  const rawPosition = player.timer.position;
  let position: number;

  if (positionCooldownFrames > 0) {
    positionCooldownFrames--;
    // Hold the last stable position while the audio timer settles.
    // The playhead is visually stationary for ~133ms — imperceptible.
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
    // Re-apply letter-spacing for the newly active phrase row.
    // (It was already applied when this row was loaded as "next", but
    // re-applying is cheap and guards against any resize between activations.)
    applyLetterSpacing(phraseRows[activeIndex]);

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
      // Pre-stretch the upcoming phrase so it's ready before it becomes active.
      applyLetterSpacing(phraseRows[nextIndex]);
    } else {
      const emptySlot = activeIsTop ? phraseBottomSlot : phraseTopSlot;
      emptySlot.innerHTML = "";
    }
  }

  const activeRow = phraseRows[activeIndex];

  // 1. Update the teal clip-path fill.
  updateLyrics(activeRow, position);

  // 2. Update the playhead dot position.
  if (activeRow.playheadElement) {
    const progress =
      (position - activeRow.phrase.startTime) /
      (activeRow.phrase.endTime - activeRow.phrase.startTime);
    const pct = Math.min(Math.max(progress * 100, 0), 100);
    activeRow.playheadElement.style.left = `${pct}%`;
  }
}

// Kick off the loop. It is self-scheduling via requestAnimationFrame and runs
// for the lifetime of the page.
tick();


// TODO (Chunk 7):        Wire keyboard and touch input
// TODO (Chunk 8):        Show start / end screens; update singer sprite
