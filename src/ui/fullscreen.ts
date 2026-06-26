/**
 * fullscreen.ts — Wires the fullscreen toggle button(s).
 *
 * requestFullscreen() must be called from a real user gesture (click/tap) —
 * browsers reject it otherwise, so there is no way to force fullscreen
 * automatically on page load. iOS Safari additionally doesn't support the
 * Fullscreen API for ordinary page content at all (only <video> elements),
 * so both buttons are hidden there via feature detection rather than shown
 * and silently failing.
 *
 * Two buttons share this behavior — one in the HUD (visible during
 * gameplay), one in the start-screen hint (visible before a song is
 * picked) — querySelectorAll over the shared .fullscreen-btn class wires
 * both identically instead of duplicating the handler.
 *
 * Call initFullscreenToggle() once at startup.
 */

import enterFullscreenIcon from "/src/assets/ui/full-screen-arrow-icon.png";
import exitFullscreenIcon from "/src/assets/ui/small-screen-arrow-icon.png";

export function initFullscreenToggle(): void {
  const fullscreenButtons =
    document.querySelectorAll<HTMLButtonElement>(".fullscreen-btn");
  const fullscreenHint = document.getElementById("fullscreen-hint") as HTMLElement;

  // One <img> per button (see index.html) — swapped together so both the
  // HUD and start-screen buttons always show the same icon for the current
  // state.
  const fullscreenIcons =
    document.querySelectorAll<HTMLImageElement>(".fullscreen-btn-icon");

  function updateFullscreenIcon(): void {
    const icon = document.fullscreenElement ? exitFullscreenIcon : enterFullscreenIcon;
    fullscreenIcons.forEach((img) => { img.src = icon; });
  }

  if (!document.documentElement.requestFullscreen) {
    fullscreenButtons.forEach((btn) => btn.classList.add("unsupported"));
    fullscreenHint.classList.add("unsupported");
    return;
  }

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

  // Covers exiting fullscreen via the OS/browser's own UI (e.g. the Esc key
  // or a system back-gesture), not just our own button — the icon needs to
  // flip back in that case too, not only on a click we initiated ourselves.
  document.addEventListener("fullscreenchange", updateFullscreenIcon);
}
