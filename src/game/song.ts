/**
 * song.ts — Song catalog and "currently selected song" state.
 *
 * A small catalog of the songs selectable from the start
 * screen, plus a mutable "current song" pointer so the HUD and end screen
 * can read one title without main.ts threading it through every function.
 */

// ─── Song descriptor shape ────────────────────────────────────────────────────

export interface SongDescriptor {
  /** Matches the `data-song-id` attribute on the corresponding start-screen
   *  button in index.html. */
  id: string;
  /** Display title shown in the HUD and end screen. */
  title: string;
  /** Composer / artist credit (not currently displayed anywhere). */
  artist: string;
  /** piapro.jp song URL, passed to player.createFromSongUrl(). */
  songUrl: string;
  /** Versioned data IDs — pinned per architecture-and-plan.md's "Important
   *  Constraints" section, so judging-time timing data can't silently
   *  change underneath the schedule built at load time. */
  video: {
    beatId: number;
    chordId: number;
    repetitiveSegmentId: number;
    lyricId: number;
    lyricDiffId: number;
  };
}

// ─── Song catalog ──────────────────────────────────────────────────────────────
//
// TODO: the three non-TAKEOVER entries below use DUMMY placeholder URLs and
// all-zero IDs so the app builds and runs end-to-end. They will NOT load a
// real song until you replace songUrl/video with the actual versioned values
// from the contest support page. TAKEOVER's values are copied as-is from the
// original onAppReady call.
export const SONGS: SongDescriptor[] = [
  {
    id: "kotaete",
    title: "こたえて",
    artist: "imie",
    songUrl: "https://piapro.jp/t/6W2N/20251215164617",
    video : { 
      // Music map correction history
      beatId : 4827293​,
      chordId : 2963754​,
      repetitiveSegmentId : 3086261, 
  
      // Lyrics URL: https://piapro.jp/t/9o24
      // Lyric timing correction history: https://textalive.jp/lyrics/piapro.jp%2Ft%2F6W2N%2F20251215164617
      lyricId : 126519​,
      lyricDiffId : 28645
    },
  },
  {
    id: "after-the-curtain",
    title: "アフター・ザ・カーテン",
    artist: "Rulmry",
    songUrl: "https://piapro.jp/t/zoqO/20251214200738",
    video: {
      // Music map correction history
      beatId: 4827294,
      chordId: 2963755,
      repetitiveSegmentId: 3086262,
      
      // Lyrics URL: https://piapro.jp/t/EVO2
      // Lyric timing correction history: https://textalive.jp/lyrics/piapro.jp%2Ft%2FzoqO%2F20251214200738
      lyricId: 126591,
      lyricDiffId: 28627
    },
  },
  {
    id: "sekai-saigo-no-ongakutai",
    title: "世界最後の音楽隊",
    artist: "夏山よつぎ × ど〜ぱみん",
    songUrl: "https://piapro.jp/t/B3yJ/20251215061727",
    video: {
      // Music map correction history
      beatId: 4827296,
      chordId: 2963757,
      repetitiveSegmentId: 3086264,
      
      // Lyrics URL: https://piapro.jp/t/9U-6
      // Lyric timing correction history: https://textalive.jp/lyrics/piapro.jp%2Ft%2FB3yJ%2F20251215061727
      lyricId: 126594,
      lyricDiffId: 28629
    },
  },
  {
    id: "takeover",
    title: "TAKEOVER",
    artist: "Twinfield",
    songUrl: "https://piapro.jp/t/E2i3/20251215092113",
    video: {
      beatId: 4827298,
      chordId: 2963759,
      repetitiveSegmentId: 3086266,

      // Lyrics URL: https://piapro.jp/t/zxWP
      // Lyric timing correction history: https://textalive.jp/lyrics/piapro.jp%2Ft%2FE2i3%2F20251215092113
      lyricId: 126533,
      lyricDiffId: 28631
    },
  },
];

// ─── Current song state ───────────────────────────────────────────────────────
//
// Mutable module-level pointer, set by main.ts's loadSong() whenever a song
// is selected or replayed. Defaults to TAKEOVER to match the previous
// hardcoded behavior if anything reads it before a selection is made
// (e.g. managed/editor mode, which skips the start screen entirely).
let currentSong: SongDescriptor = SONGS[SONGS.length - 1];

export function setCurrentSong(song: SongDescriptor): void {
  currentSong = song;
}

export function getCurrentSong(): SongDescriptor {
  return currentSong;
}
