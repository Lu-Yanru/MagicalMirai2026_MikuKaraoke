/**
 * loading-screen.ts — Full-viewport loading overlay shown while a song is
 * being fetched and game state (cue schedule, singer, HUD) is rebuilt.
 *
 * Purely DOM toggling, same pattern as start-screen.ts's
 * showStartScreen()/hideStartScreen(). main.ts owns the `isLoading` boolean
 * and decides WHEN to call these (song select, "Play again") and WHICH
 * buttons to disable; this module only flips the shared `.hidden` class on
 * #screen-loading.
 */

const screenLoading = document.getElementById("screen-loading") as HTMLElement;

export function showLoadingScreen(): void {
  screenLoading.classList.remove("hidden");
}

export function hideLoadingScreen(): void {
  screenLoading.classList.add("hidden");
}
