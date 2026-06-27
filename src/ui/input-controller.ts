/**
 * input-controller.ts — Keyboard and touch/click input wiring.
 *
 * Handles:
 *   - Mapping ArrowUp/Down/Left/Right keys to Direction values.
 *   - Visual "pressed" feedback on the on-screen direction buttons, synced
 *     between keyboard and touch/mouse input (touch/mouse get this for free
 *     via the native :active pseudo-class; keyboard needs it applied
 *     manually).
 *   - The e.repeat guard that stops a held key from re-triggering input.
 *     Browsers auto-repeat keydown while a key is held; without this guard
 *     a held key's repeat could land inside a cue's hit window and resolve
 *     it as a hit instead of a miss.
 *   - touchstart (not click) on the input pad for lower latency on mobile,
 *     with preventDefault() to avoid the ~300ms-delayed synthetic click that
 *     would otherwise double-fire the input.
 *
 * The caller supplies isLoading()/isEndScreenShown() (input must be ignored
 * in both cases — kept as two separate predicates because the original
 * keyup handler only ever checked end-screen state, not loading state) and
 * onDirection() (called with the pressed Direction whenever a fresh,
 * unblocked press occurs — main.ts owns what happens next, e.g. looking up
 * the active phrase row and calling ScoreManager).
 */

import type { Direction } from "../types";

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp:    "up",
  ArrowDown:  "down",
  ArrowLeft:  "left",
  ArrowRight: "right",
};

export interface InputControllerOptions {
  inputPad: HTMLElement;
  directionButtons: Record<Direction, HTMLButtonElement>;
  isLoading: () => boolean;
  isEndScreenShown: () => boolean;
  onDirection: (direction: Direction) => void;
}

export function initInputController(options: InputControllerOptions): void {
  const { inputPad, directionButtons, isLoading, isEndScreenShown, onDirection } = options;

  // ── Keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (isLoading()) return;
    if (isEndScreenShown()) return;

    const direction = KEY_TO_DIRECTION[e.key];
    if (!direction) return;
    e.preventDefault();

    // Visual sync: press the on-screen button to match the key, regardless
    // of whether a cue is currently active.
    directionButtons[direction].classList.add("key-pressed");

    // Ignore auto-repeated keydown events from a held key — see header
    // comment for why.
    if (e.repeat) return;

    onDirection(direction);
  });

  // Release the visual press on keyup. keyup fires once on release even
  // though keydown auto-repeats, so this naturally holds the pressed look
  // for the full hold duration with no extra debouncing logic.
  document.addEventListener("keyup", (e) => {
    if (isEndScreenShown()) return;

    const direction = KEY_TO_DIRECTION[e.key];
    if (!direction) return;
    directionButtons[direction].classList.remove("key-pressed");
  });

  // ── Touch / click ─────────────────────────────────────────────────────────
  // Single delegated handler covers all four buttons.
  function handlePadInput(target: EventTarget | null): void {
    if (isLoading()) return;
    if (isEndScreenShown()) return;

    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button");
    const dir = button?.dataset["direction"] as Direction | undefined;
    if (!dir || !button) return;
    onDirection(dir);
  }

  // { passive: false } is required so e.preventDefault() is allowed —
  // prevents the synthetic click that would otherwise fire ~300ms later and
  // double-trigger the input.
  inputPad.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const target = e.target;
      if (target instanceof HTMLElement) {
        const button = target.closest("button");
        button?.classList.add("key-pressed");
      }
      handlePadInput(e.target);
    },
    { passive: false }
  );

  inputPad.addEventListener("touchend", (e) => {
    const target = e.target;
    if (target instanceof HTMLElement) {
      const button = target.closest("button");
      button?.classList.remove("key-pressed");
    }
  });

  inputPad.addEventListener("touchcancel", (e) => {
    const target = e.target;
    if (target instanceof HTMLElement) {
      const button = target.closest("button");
      button?.classList.remove("key-pressed");
    }
  });

  inputPad.addEventListener("click", (e) => {
    handlePadInput(e.target);
  });
}
