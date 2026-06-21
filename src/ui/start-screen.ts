/**
 * start-screen.ts — Song-select start screen and its "How to Play" modal.
 *
 * Both overlays are static markup already in index.html (#screen-start,
 * #screen-how-to-play). This module only wires their buttons and toggles
 * the shared `.hidden` class — unlike lyrics.ts/arrows.ts it does not build
 * any DOM at runtime, because the layout is fixed (exactly 4 song buttons +
 * 1 how-to-play button), so static HTML is simpler than generating it from
 * SongDescriptor[].
 *
 * Song buttons are matched to SongDescriptor entries by `data-song-id`,
 * which must exactly match a SongDescriptor.id in song.ts.
 */

import type { SongDescriptor } from "../game/song";

const screenStart      = document.getElementById("screen-start")         as HTMLElement;
const screenHowToPlay  = document.getElementById("screen-how-to-play")   as HTMLElement;
const btnHowToPlay     = document.getElementById("btn-how-to-play")      as HTMLButtonElement;
const btnHowToPlayBack = document.getElementById("btn-how-to-play-back") as HTMLButtonElement;

/**
 * Wire song selection and the how-to-play modal. Call once at startup.
 *
 * @param songs        — All selectable songs (song.ts's SONGS array).
 * @param onSongSelect — Called with the chosen SongDescriptor on click.
 *                       Caller owns hiding the start screen and loading the song.
 */
export function initStartScreen(
  songs: SongDescriptor[],
  onSongSelect: (song: SongDescriptor) => void
): void {
  const songButtons =
    screenStart.querySelectorAll<HTMLButtonElement>(".song-button[data-song-id]");

  songButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset["songId"];
      const song = songs.find((s) => s.id === id);
      if (!song) {
        // A data-song-id in index.html with no matching SongDescriptor is a
        // wiring bug, not a runtime condition to silently recover from.
        console.error(`No SongDescriptor found for data-song-id="${id}"`);
        return;
      }
      onSongSelect(song);
    });
  });

  btnHowToPlay.addEventListener("click", () => {
    screenHowToPlay.classList.remove("hidden");
  });

  btnHowToPlayBack.addEventListener("click", () => {
    screenHowToPlay.classList.add("hidden");
  });
}

export function showStartScreen(): void {
  screenStart.classList.remove("hidden");
}

export function hideStartScreen(): void {
  screenStart.classList.add("hidden");
}
