/**
 * highscore.ts — Per-song local high score, persisted via localStorage.
 *
 * Scope and limitations:
 *   - Storage is per ORIGIN per BROWSER PROFILE, not "per player." It does
 *     not sync across devices or browsers, and is not visible to another
 *     browser profile or an incognito/private window once that window's
 *     session ends.
 *   - Survives closing the tab/window and restarting the browser, as long
 *     as the user doesn't clear "site data" / "cookies and other site
 *     data" for this origin — a DIFFERENT setting than "cached images and
 *     files," which does NOT remove localStorage.
 *   - Some browsers (notably iOS Safari's Intelligent Tracking Prevention,
 *     in some past versions) have evicted script-writable storage for
 *     origins not revisited within ~7 days. Not verified against the
 *     current Safari version — don't rely on survival across a long gap.
 *
 * Tracks ONE number per song: the player's best score (top-1, no history).
 * All localStorage calls are wrapped in try/catch because setItem can throw
 * (quota exceeded, or storage disabled in some private-browsing modes) —
 * a failed save must never crash the end screen.
 */

const STORAGE_PREFIX = "miku-karaoke-highscore:";

/**
 * Read the stored high score for a song. Returns 0 if none is stored yet,
 * or if the stored value is missing/corrupt/unparseable.
 *
 * @param songId — SongDescriptor.id (see song.ts).
 */
export function getHighscore(songId: string): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + songId);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // localStorage unavailable — fail soft, treat as "no high score yet."
    return 0;
  }
}

/**
 * Save `score` as the new high score for `songId` IF it beats the current
 * stored value. No-op (and returns false) otherwise.
 *
 * @returns true if this score is a new record AND was successfully saved.
 */
export function saveHighscoreIfBetter(songId: string, score: number): boolean {
  const current = getHighscore(songId);
  if (score <= current) return false;

  try {
    localStorage.setItem(STORAGE_PREFIX + songId, String(score));
    return true;
  } catch {
    // Save failed silently (quota / disabled storage). Returning true here
    // would show "New Record!" for a value we couldn't actually persist —
    // misleading — so report false instead.
    return false;
  }
}
