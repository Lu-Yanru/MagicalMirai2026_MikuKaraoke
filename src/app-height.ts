/**
 * app-height.ts — iOS-safe viewport height fix.
 *
 * 100dvh is not fully reliable on iOS — there's a confirmed WebKit bug
 * (https://bugs.webkit.org/show_bug.cgi?id=261185) where dvh/svh don't
 * correctly reflect the real visible height when the Safari tab bar's size
 * varies (e.g. landscape with multiple tabs open, as observed). We instead
 * read window.visualViewport.height directly — it tracks the actual visible
 * pixel height continuously and isn't subject to that bug — and write it to
 * a CSS variable that the layout uses instead of vh/dvh.
 *
 * initAppHeight() wires the resize/orientation listeners once at startup.
 * updateAppHeight() is also exported directly so other code (main.ts's
 * loadSong, and the main-menu button) can force a re-measure right after a
 * tap-driven screen transition, where iOS Safari's toolbar may still be
 * mid-resize-animation.
 */

export function updateAppHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  const root = document.documentElement.style;
  root.setProperty("--app-height", `${height}px`);
  // Explicit pixel heights for the three game-screen sections, computed
  // directly from the measured height — not flex-grow distribution. A flex
  // item's content can still force it past a flex-basis/flex-grow
  // allocation (default min-height: auto), which is what caused the
  // upward shift once real lyric/singer content was populated. An explicit
  // height with flex-grow/shrink: 0 has no such override path.
  root.setProperty("--hud-height", `${height * 0.08}px`);
  root.setProperty("--stage-height", `${height * 0.72}px`);
  root.setProperty("--input-height", `${height * 0.20}px`);
}

export function initAppHeight(): void {
  updateAppHeight();
  window.visualViewport?.addEventListener("resize", updateAppHeight);
  window.addEventListener("resize", updateAppHeight);
  window.addEventListener("orientationchange", updateAppHeight);
}
