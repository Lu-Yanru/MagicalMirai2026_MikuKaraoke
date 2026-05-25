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
// In local development it comes from a .env file or a Codespace secret.
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

      // こたえて / imie (Grand Prize)
      // Note: chorus characters in paragraph 3 have 1 ms timing — see the
      // design doc and the chorus timings JSON linked from the support page.
    //   player.createFromSongUrl("https://piapro.jp/t/6W2N/20251215164617", {
    //     video: {
    //       // 音楽地図訂正履歴
    //       beatId: 4827293,
    //       chordId: 2963754,
    //       repetitiveSegmentId: 3086261,
      
    //       // 歌詞URL: https://piapro.jp/t/9o24
    //       // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2F6W2N%2F20251215164617
    //       lyricId: 126519,
    //       lyricDiffId: 28645
    //     },
    //   });

      // アフター・ザ・カーテン / Rulmry
      player.createFromSongUrl("https://piapro.jp/t/zoqO/20251214200738", {
        video: {
          // 音楽地図訂正履歴
          beatId: 4827294,
          chordId: 2963755,
          repetitiveSegmentId: 3086262,
      
          // 歌詞URL: https://piapro.jp/t/EVO2
          // 歌詞タイミング訂正履歴: https://textalive.jp/lyrics/piapro.jp%2Ft%2FzoqO%2F20251214200738
          lyricId: 126591,
          lyricDiffId: 28627
        },
      });

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
    // Log beat count using the beats array on the song map.
    // ISongMap.beats: IBeat[] — confirmed at:
    // https://developer.textalive.jp/packages/textalive-app-api/interfaces/ISongMap.html
    const beatCount = player.data.songMap.beats.length;

    // Walk the IChar linked list to count characters.
    // IChar.next is typed as IChar (not IRenderingUnit) — confirmed at:
    // https://developer.textalive.jp/packages/textalive-app-api/interfaces/IChar.html
    let charCount = 0;
    let char = player.video.firstChar;
    while (char) {
      charCount++;
      char = char.next;
    }

    console.log(`beats: ${beatCount}, chars: ${charCount}`);

    // TODO (Chunk 3):        Call buildSchedule(player) to build the cue list.
    // TODO (Chunk 5):        Call buildLyricDOM(player, container).
  },
});

// ─── Temporary playback control (Chunk 2) ────────────────────────────────────
//
// Browsers block autoplay, so song loading can only be triggered by a user
// gesture. This button provides that gesture for testing purposes.
// It will be removed when the full UI layout is built in Chunk 4.
//
// player.isPlaying is a boolean accessor on IPlayer — confirmed at:
// https://developer.textalive.jp/packages/textalive-app-api/interfaces/IPlayer.html
const btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
btnPlay.addEventListener("click", () => {
  if (player.isPlaying) {
    player.requestPause();
  } else {
    player.requestPlay();
  }
});

// ─── onAppMediaChange listener (Chunk 2 Step 7) ──────────────────────────────
//
// Called when the song URL is changed by the TextAlive host (e.g. the editor
// switches tracks). Logging here confirms the full app lifecycle is wired:
// onAppReady → song loads → onVideoReady → onAppMediaChange on track switch.
//
// songUrl is the new song URL. videoPromise resolves to the new IVideo once
// loading completes (same as the next onVideoReady call).
//
// onAppMediaChange is on PlayerAppListener — confirmed at:
// https://developer.textalive.jp/packages/textalive-app-api/interfaces/PlayerAppListener.html
player.addListener({
  onAppMediaChange(songUrl: string) {
    console.log("media changed:", songUrl);
  },
});

// TODO (Chunk 4):        Mount HTML layout
// TODO (Chunk 5):        Start requestAnimationFrame render loop
// TODO (Chunk 7):        Wire keyboard and touch input
// TODO (Chunk 8):        Show start / end screens; update singer sprite