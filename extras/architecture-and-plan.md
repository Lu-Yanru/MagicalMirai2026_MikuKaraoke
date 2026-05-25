# Rhythm Lyric Game — Architecture & Implementation Plan

---

## Technology Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | TypeScript | TextAlive API ships with type definitions; autocomplete on all API interfaces |
| Bundler | Vite | Zero-config TypeScript support; fast dev server; produces static output |
| API | textalive-app-api (npm) | Beat, character, and lyric timing data |
| Hosting | GitHub Pages | Free static hosting; fits contest static-only requirement |
| CI/CD | GitHub Actions | Auto-deploy on push to `main` |
| Codespace | GitHub Codespaces | Node.js pre-installed; no local setup needed |

---

## File Structure

```
project-root/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← GitHub Actions: build + deploy to gh-pages
├── public/
│   └── (no files needed here for now)
├── src/
│   ├── main.ts                 ← Entry point: creates Player, mounts UI, wires events
│   ├── style.css               ← Global styles, layout, animations
│   ├── types.ts                ← Shared TypeScript interfaces
│   │
│   ├── game/
│   │   ├── scheduler.ts        ← Beat-to-character mapping; builds the cue schedule
│   │   ├── scoring.ts          ← Hit detection, rating calculation, score + combo state
│   │   └── singer.ts           ← Singer state machine (idle/happy/great/sad)
│   │
│   └── ui/
│       ├── arrows.ts           ← Arrow cue div lifecycle (spawn, resolve, animate out)
│       ├── lyrics.ts           ← Per-character color flip, phrase scrolling
│       └── rating.ts           ← Rating word display and float-up animation
│
├── assets/
│   └── singer/
│       ├── idle.png            ← Singer sprite: default state
│       ├── happy.png           ← Singer sprite: combo ≥ 10 or Perfect hit
│       ├── great.png           ← Singer sprite: combo ≥ 5
│       └── sad.png             ← Singer sprite: Miss or Bad, combo = 0
│
├── index.html                  ← Single HTML shell; all content injected by JS
├── vite.config.ts              ← base path set to repo name for GitHub Pages
├── tsconfig.json               ← strict mode
└── package.json
```

---

## Architecture Overview

The app has four layers that communicate in one direction (API → Game → UI → DOM). There is no shared mutable global state outside of the game engine module.

```
TextAlive App API
  │  Player object, beat events, character timing, word timing
  ▼
Game Engine (src/game/)
  │  scheduler.ts  — builds CueSchedule[] at load time
  │  scoring.ts    — maintains score, combo, processes hits
  │  singer.ts     — derives singer state from score state
  ▼
UI Layer (src/ui/)
  │  arrows.ts     — renders and removes arrow cue divs
  │  lyrics.ts     — updates character span colors each animation frame
  │  rating.ts     — injects rating word, triggers CSS animation
  ▼
DOM / CSS
     index.html structure + style.css animations
```

### Key Data Flow

1. `onVideoReady` fires → `scheduler.ts` walks beats + characters → produces `CueEntry[]`
2. `requestAnimationFrame` loop runs every frame:
   - `scoring.ts` checks current position against pending cues
   - `lyrics.ts` calls `player.video.findChar(pos)` → updates colored spans
   - `arrows.ts` shows/hides cue divs based on schedule
3. Keypress / touch → `scoring.ts.handleInput(direction)` → rating → `rating.ts` displays word → `singer.ts` updates state

### Core Types (`src/types.ts`)

```ts
export type Direction = 'up' | 'down' | 'left' | 'right';

export type RatingType = 'Perfect' | 'Great' | 'Good' | 'Bad' | 'Miss';

export interface CueEntry {
  beatTime: number;       // ms — beat timestamp from API
  char: IChar;            // TextAlive character object
  direction: Direction;   // randomly assigned at schedule build time
  element: HTMLElement | null;  // the active cue div, null before spawned
  timeoutId: number | null;     // miss timeout handle
  resolved: boolean;      // true once rated (prevents double-scoring)
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<RatingType, number>;
}

export type SingerState = 'idle' | 'happy' | 'great' | 'sad';
```

---

## Implementation Plan

The project is broken into 8 chunks. Each chunk produces something runnable and testable before the next chunk begins. Within each chunk, steps are ordered so that each one is safe to implement and verify independently.

---

### Chunk 1 — Project scaffold and build pipeline

**Goal**: A blank page that builds, runs in Codespace, and deploys to GitHub Pages without errors.

**Success criterion**: `npm run dev` shows a blank dark page with no console errors. Pushing to `main` triggers the GitHub Actions workflow and the page is accessible at `https://username.github.io/repo-name/`.

#### Steps

x 1. In the Codespace terminal, scaffold the project:
   ```bash
   npm create vite@latest . -- --template vanilla-ts
   npm install
   npm install textalive-app-api
   ```

x 2. Edit `vite.config.ts`:
   ```ts
   import { defineConfig } from 'vite'
   export default defineConfig({
     base: '/your-repo-name/',
   })
   ```

x 3. Clean up Vite boilerplate:
   ```bash
   rm -rf src/counter.ts src/typescript.svg public/vite.svg
   ```

x 4. Replace `index.html` with a minimal shell (dark background, single `<div id="app">`, script tag pointing to `src/main.ts`).

x 5. Replace `src/style.css` with base reset: `box-sizing: border-box`, `body` dark background `#0a0a0f`, white text, `height: 100vh`, `overflow: hidden`.

x 6. Replace `src/main.ts` with `console.log('scaffold ok')`.

x 7. Run `npm run dev` and verify the blank page loads with no errors.

x 8. Create `.github/workflows/deploy.yml` with the GitHub Actions workflow (checkout → setup-node → `npm install` → `npm run build` with `VITE_TEXTALIVE_TOKEN` env var → deploy to `gh-pages` branch using `peaceiris/actions-gh-pages@v4`).

x 9. Add `VITE_TEXTALIVE_TOKEN` as a repository Actions secret (Settings → Secrets → Actions).

10. Set GitHub Pages source to branch `gh-pages`, folder `/ (root)` in repo Settings → Pages.

11. Push to `main`, confirm the Actions workflow passes, and confirm the deployed page loads at the GitHub Pages URL.

---

### Chunk 2 — TextAlive Player initialization

**Goal**: The TextAlive Player loads a song, and the app logs beat count and character count to the console. No UI yet.

**Success criterion**: Console shows `beats: N, chars: M` where N and M are non-zero numbers for the chosen song.

#### Steps

1. Create `src/types.ts` with the `Direction`, `RatingType`, `CueEntry`, `ScoreState`, and `SingerState` type definitions.

2. In `src/main.ts`, import `Player` from `textalive-app-api` and instantiate it:
   ```ts
   const player = new Player({
     app: { token: import.meta.env.VITE_TEXTALIVE_TOKEN },
   });
   ```

3. Add a `player.addListener` block with `onAppReady` and `onVideoReady` callbacks. In `onAppReady`, call `player.createFromSongUrl(...)` with the versioned URL and `video` options (beatId, chordId, repetitiveSegmentId, lyricId, lyricDiffId) copied from the contest support page snippet.

4. In `onVideoReady`, log the beat array length (`player.data.songMap.beats.length`) and walk `player.video.firstChar` to count characters, logging the total.

5. Add basic playback controls (Play/Pause button in HTML) so you can trigger loading without autoplay issues. Wire to `player.requestPlay()` and `player.requestPause()`.

6. Run `npm run dev`, click Play, and verify the console logs show correct non-zero counts.

7. Add a `onAppMediaChange` listener that logs when the song changes, to confirm the lifecycle is wired correctly.

**Note**: Verify `IBeat` property names in the API reference at `https://developer.textalive.jp/packages/textalive-app-api/interfaces/IBeat.html` before using `.startTime` — the actual property name may differ.

---

### Chunk 3 — Beat-to-character mapping (scheduler)

**Goal**: `scheduler.ts` produces a `CueEntry[]` array. Log it to the console and visually verify a few entries make sense against the lyrics.

**Success criterion**: Console shows a list of `{ beatTime, charText, direction }` entries. No two entries share the same character. No entry falls within the duration of a previous character.

#### Steps

1. Create `src/game/scheduler.ts` exporting a single function:
   ```ts
   export function buildSchedule(player: Player): CueEntry[]
   ```

2. Inside, convert `player.video.firstChar` linked list to an array of `IChar` objects by walking `.next`.

3. Get the beats array from `player.data.songMap.beats`. Verify the correct property name for the beat timestamp against the API docs before using it.

4. For each beat, find a character whose `startTime` is within ±100ms of the beat timestamp and has not already been assigned to a previous cue. If found, create a `CueEntry` with a random direction and `resolved: false`.

5. Add a helper `randomDirection(): Direction` that returns one of the four directions with equal probability.

6. Call `buildSchedule(player)` inside `onVideoReady` in `main.ts` and log the result.

7. Manually verify 5–10 entries by comparing `charText` and `beatTime` to the song's known lyrics and tempo. They should feel evenly distributed and not cluster on long-held notes.

8. Handle the special case noted in the contest docs: the Grand Prize song "こたえて" has chorus characters with 1ms timing. These will effectively never match a beat and will naturally be skipped by the scheduler — confirm this in the log.

---

### Chunk 4 — HTML layout and static UI shell

**Goal**: The full UI layout is visible with placeholder content. No game logic yet.

**Success criterion**: The page shows the singer area, lyric area, score/combo display, and four arrow buttons in their correct positions. Looks correct on both desktop and a narrow (375px) mobile viewport.

#### Steps

1. Design the HTML structure in `index.html` (or inject via `main.ts`):
   - `#hud` — top bar with song title, score, combo
   - `#stage` — contains `#singer` (image) and `#cue-area` (where arrow divs appear)
   - `#lyric-area` — scrollable text container
   - `#input-pad` — four directional buttons

2. In `src/style.css`, implement the layout using CSS Grid or Flexbox. The page should fill `100vh` with no overflow. Suggested row distribution: HUD ~10%, stage ~35%, lyrics ~30%, input pad ~25%.

3. Style `#input-pad` with four large touch-friendly buttons (minimum 80px × 80px tap targets), arranged in a cross/diamond layout or a 2×2 grid. Label them with arrow Unicode characters (↑ ↓ ← →).

4. Add placeholder singer image (can be a colored rectangle for now) in `#singer`.

5. Add placeholder lyric text in `#lyric-area` with a few Japanese characters styled as `<span>` elements, some with a `.sung` class (colored teal) and some unstyled — to preview the color flip effect.

6. Test on desktop and use browser DevTools to simulate a 375px mobile viewport. Adjust as needed.

---

### Chunk 5 — Lyric rendering and color flip

**Goal**: Real lyrics from the API render in `#lyric-area`. Characters light up in real time as the song plays.

**Success criterion**: Play the song. Characters turn teal exactly when they are sung. The lyric area scrolls smoothly to keep the current phrase visible.

#### Steps

1. Create `src/ui/lyrics.ts` exporting:
   - `buildLyricDOM(player: Player, container: HTMLElement): void` — renders all phrases as divs, all characters as `<span data-start="..." data-end="...">` elements
   - `updateLyrics(player: Player, container: HTMLElement): void` — called each animation frame; finds the current char and updates `.sung` class

2. In `buildLyricDOM`, walk `player.video.firstPhrase → firstWord → firstChar` (nested linked lists). For each phrase, create a `<div class="phrase">`. For each character, create a `<span>` with `data-start` set to `char.startTime` and `data-end` set to `char.endTime`.

3. In `updateLyrics`, call `player.video.findChar(player.timer.position)` to get the current character. Find its span by `data-start` attribute and add class `sung`. Remove `sung` from any span whose `data-end` is in the past.

4. Call `buildLyricDOM` inside `onVideoReady`. Start a `requestAnimationFrame` loop in `main.ts` after playback begins, calling `updateLyrics` each frame.

5. Implement phrase scrolling: when the current phrase changes, call `phraseElement.scrollIntoView({ behavior: 'smooth', block: 'center' })` on the phrase div.

6. Add CSS for `.sung` (color teal `#1D9E75`), `.phrase` (margin, line-height), and `span` (transition: `color 80ms ease`).

7. Test: play the song, watch characters light up. Verify that a held character (one with a long duration) stays lit until its `endTime` and does not prematurely advance.

---

### Chunk 6 — Arrow cues and miss detection

**Goal**: Arrow cues appear on screen at the correct beat times and resolve to "Miss" if not pressed.

**Success criterion**: Without pressing anything, play the song for 30 seconds. Arrow cues appear over the lyric area, float upward, and are replaced by a red "Miss" label that also floats up and fades. No arrows are shown on beats mid-character.

#### Steps

1. Create `src/ui/arrows.ts` exporting:
   - `spawnCue(entry: CueEntry, container: HTMLElement): void`
   - `resolveCue(entry: CueEntry, rating: RatingType): void`

2. In `spawnCue`: create a `<div class="cue">` positioned absolutely over the character's span (use `getBoundingClientRect()` on the character's `<span>` to get position). Set inner text to the arrow Unicode character. Store the element on `entry.element`. Set a `setTimeout` for `250 + 50 = 300ms` that calls `resolveCue(entry, 'Miss')` if `entry.resolved` is still `false`. Store the timeout ID on `entry.timeoutId`.

3. In `resolveCue`: if `entry.resolved` is `true`, return immediately (guard against double-resolution). Set `entry.resolved = true`. Replace the div's text content with the rating string. Apply a CSS class matching the rating (`.rating-perfect`, `.rating-miss`, etc.). After the animation duration (600ms), remove the element from the DOM.

4. Create `src/ui/rating.ts` exporting the CSS class names and a color map for the five ratings. Keep styling logic here, not in `arrows.ts`.

5. Add CSS for `.cue` (absolute position, large font, z-index above lyrics), and `@keyframes ratingPop` (translateY 0 → -40px, opacity 1 → 0, duration 600ms, `forwards`). Add color classes for each rating.

6. In the `requestAnimationFrame` loop in `main.ts`, iterate `scheduledCues`. For each entry where `!entry.resolved && !entry.element && player.timer.position >= entry.beatTime - 100`, call `spawnCue`.

7. Test: play without pressing anything. Confirm all arrows become "Miss". Confirm no arrows appear between the start and end of a long-held character.

---

### Chunk 7 — Input handling and scoring

**Goal**: Pressing the correct arrow key (or button) at the right time produces a rating. Score and combo update on screen.

**Success criterion**: Play the song and press arrow keys. Correct presses produce "Perfect"/"Great"/"Good"/"Bad" labels. Wrong-direction presses are ignored. Score and combo increment and reset correctly.

#### Steps

1. Create `src/game/scoring.ts` exporting:
   - `ScoreManager` class with `state: ScoreState`, `handleInput(direction: Direction, now: number, cues: CueEntry[]): void`, and `applyRating(rating: RatingType): void`

2. In `handleInput`: find the first unresolved cue in `cues` whose `beatTime` is within the past 250ms and future 250ms (the active window). If none, return (stray press). If found and `direction !== cue.direction`, return (wrong direction — miss timeout handles it). If direction matches, compute `delta = Math.abs(now - cue.beatTime)` and derive rating from the timing windows. Call `clearTimeout(cue.timeoutId)`. Call `resolveCue(cue, rating)`. Call `applyRating(rating)`.

3. In `applyRating`: update `state.score` (Perfect: +300, Great: +200, Good: +100, Bad: +50, Miss: +0). Increment `state.combo` for Perfect/Great/Good; reset to 0 for Bad/Miss. Update `state.maxCombo`. Increment `state.counts[rating]`. Emit a custom DOM event `scoreupdate` with the new state so the HUD can react without `scoring.ts` knowing about the DOM.

4. Add keyboard listener in `main.ts`:
   ```ts
   document.addEventListener('keydown', (e) => {
     const map: Record<string, Direction> = {
       ArrowUp: 'up', ArrowDown: 'down',
       ArrowLeft: 'left', ArrowRight: 'right'
     };
     if (map[e.key]) scoreManager.handleInput(map[e.key], player.timer.position, scheduledCues);
   });
   ```

5. Add `click` / `touchstart` listeners on the four `#input-pad` buttons, each calling `handleInput` with the appropriate direction.

6. In `main.ts`, listen for `scoreupdate` and update `#score` and `#combo` text content in the HUD.

7. Test: play the song. Verify each rating fires correctly. Verify stray presses do nothing. Verify combo resets on Bad and Miss. Verify the miss timeout still fires if you press wrong direction.

---

### Chunk 8 — Singer state machine and polish

**Goal**: The singer sprite reacts to score state. The game has a start screen and an end screen. The app is ready for submission.

**Success criterion**: Full playthrough works end-to-end. Singer changes expression visibly. Results are shown at song end. The app runs correctly on mobile (touch) and desktop (keyboard).

#### Steps

1. Create `src/game/singer.ts` exporting:
   - `getSingerState(state: ScoreState, lastRating: RatingType | null): SingerState`

2. Implement state logic:
   - `idle`: before playback or between phrases
   - `happy`: last rating was Perfect, or combo ≥ 10
   - `great`: combo ≥ 5 and < 10
   - `sad`: last rating was Miss or Bad, or combo === 0 after a non-zero combo

3. In `main.ts`, on each `scoreupdate` event, call `getSingerState` and update the `<img id="singer">` src attribute to the matching asset path. Add a CSS class `singer-bounce` that plays a brief scale animation (1 → 1.1 → 1) on state change, removed after the animation ends.

4. Add real singer sprite images to `assets/singer/`. If final art is not ready, use clearly labeled placeholder colored rectangles for now and swap in real art later.

5. Add a start screen overlay (`#screen-start`) shown before playback begins. It should display the song title, a "Tap to start" prompt, and song selection if multiple songs are supported. Clicking/tapping dismisses it and calls `player.requestPlay()`.

6. Add an end screen overlay (`#screen-end`) shown when `onStop` fires (end of song). Display total score, max combo, and a count of each rating. Add a "Play again" button that reloads the page.

7. Wire `player.addListener({ onStop: showEndScreen })`.

8. Final responsive check: open DevTools, simulate iPhone SE (375×667). Verify buttons are tappable, lyrics are readable, singer is visible, no overflow.

9. Final accessibility pass: add `aria-label` to all four input buttons. Ensure the page has a `<title>` and `lang="ja"` on `<html>`.

10. Run `npm run build` locally and check the `dist/` folder. Open `dist/index.html` via a local HTTP server (`npx serve dist`) to confirm the production build works, including asset paths.

11. Push to `main`. Confirm GitHub Actions deploys successfully. Test the live GitHub Pages URL on both desktop and a real mobile device.

---

## Timing Reference

Approximate time budget for a 1-month development window:

| Chunk | Estimated time |
|-------|---------------|
| 1 — Scaffold | 0.5 day |
| 2 — Player init | 1 day |
| 3 — Scheduler | 1–2 days |
| 4 — UI layout | 1–2 days |
| 5 — Lyric color flip | 2 days |
| 6 — Arrow cues + miss | 2–3 days |
| 7 — Input + scoring | 2–3 days |
| 8 — Singer + polish | 3–4 days |
| Singer art (parallel) | 1 week (start early) |
| Buffer / bug fixing | 3–4 days |

**Total: ~3.5 weeks of focused part-time work.**

Start the singer art in week 1 in parallel with Chunks 1–3. Art is the biggest scheduling wildcard since it cannot be AI-generated and requires either drawing skill or finding a licensed artist.

---

## Important Constraints and Reminders

- Singer art must not be AI-generated (contest rule). Start early.
- The TextAlive app token must not be committed to the repository. Use `VITE_TEXTALIVE_TOKEN` as a Vite environment variable, loaded from GitHub Secrets in CI and from a Codespace secret in development.
- The repository must remain **private** until judging is complete. Do not publish demo videos or screenshots before the submission deadline.
- After the submission deadline, do not push any commits until prize-winning entries are announced — the final commit at the deadline is what is judged.
- Use the versioned song URLs with explicit `beatId`, `lyricId`, and `lyricDiffId` values from the contest support page to ensure timing data does not change during judging.
- The Grand Prize song "こたえて" has chorus characters with artificially short (1ms) timing. The scheduler will naturally skip these, but verify this during Chunk 3 testing.
- Always verify API method and property names against the live documentation at `https://developer.textalive.jp/packages/textalive-app-api/modules.html` before using them. Do not assume property names from memory.
