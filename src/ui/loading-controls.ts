/**
 * loading-controls.ts — Tracks the "song is loading" flag and disables
 * input while it's set.
 *
 * Disables the actual button elements (not just relying on the loading
 * overlay's z-index) so keyboard activation of a focused-but-covered button
 * can't slip through either.
 *
 * Call createLoadingController() once at startup; it owns the isLoading
 * flag so main.ts and input-controller.ts both read it through
 * controller.isLoading() rather than each keeping their own copy.
 */

import { showLoadingScreen, hideLoadingScreen } from "./loading-screen";
import type { Direction } from "../types";

export interface LoadingController {
  startLoading: () => void;
  finishLoading: () => void;
  isLoading: () => boolean;
}

export function createLoadingController(
  btnPlay: HTMLButtonElement,
  directionButtons: Record<Direction, HTMLButtonElement>
): LoadingController {
  let loading = false;

  function startLoading(): void {
    loading = true;
    showLoadingScreen();
    btnPlay.disabled = true;
    for (const dir of Object.keys(directionButtons) as Direction[]) {
      directionButtons[dir].disabled = true;
    }
  }

  function finishLoading(): void {
    loading = false;
    hideLoadingScreen();
    btnPlay.disabled = false;
    for (const dir of Object.keys(directionButtons) as Direction[]) {
      directionButtons[dir].disabled = false;
    }
  }

  return {
    startLoading,
    finishLoading,
    isLoading: () => loading,
  };
}
