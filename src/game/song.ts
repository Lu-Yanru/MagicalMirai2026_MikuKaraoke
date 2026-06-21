/**
 * song.ts — Single source of truth for "which song is currently loaded."
 *
 * To add song selection later: turn CURRENT_SONG into an array indexed by
 * id, add a setter, and have onAppReady's createFromSongUrl call read from
 * whatever the selector last chose. No other module needs to change shape —
 * they already only read CURRENT_SONG.title (and, if needed, the video params).
 */

// ─── Song descriptor shape ────────────────────────────────────────────────────

export interface SongDescriptor {
  /** Display title shown in the HUD and end screen. */
  title: string;
  /** Composer / artist credit (not currently displayed anywhere, kept for
   *  parity with the contest's required attribution and for future use). */
  artist: string;
  /** piapro.jp song URL, passed to player.createFromSongUrl(). */
  songUrl: string;
  /** Versioned data IDs — pinned per extras/architecture-and-plan.md's
   *  "Important Constraints" section, so judging-time timing data can't
   *  silently change underneath the schedule built at load time. */
  video: {
    beatId: number;
    chordId: number;
    repetitiveSegmentId: number;
    lyricId: number;
    lyricDiffId: number;
  };
}

// ─── Current song ─────────────────────────────────────────────────────────────
//
// TAKEOVER / Twinfield — values copied as-is from the existing
// player.createFromSongUrl(...) call in main.ts's onAppReady. main.ts should
// be updated to read these values from here instead of repeating them inline
// so there is exactly one place
// that defines "the current song."
export const CURRENT_SONG: SongDescriptor = {
  title: "TAKEOVER",
  artist: "Twinfield",
  songUrl: "https://piapro.jp/t/E2i3/20251215092113",
  video: {
    beatId: 4827298,
    chordId: 2963759,
    repetitiveSegmentId: 3086266,
    lyricId: 126533,
    lyricDiffId: 28631,
  },
};
