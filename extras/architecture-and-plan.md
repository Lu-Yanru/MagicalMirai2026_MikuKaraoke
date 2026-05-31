# Rhythm Lyric Game — Architecture & Implementation Plan

---

## Technology Stack

| Layer     | Choice                  | Reason                                                              |
|-----------|-------------------------|---------------------------------------------------------------------|
| Language  | TypeScript              | TextAlive API ships with type definitions; autocomplete on all interfaces |
| Bundler   | Vite                    | Zero-config TypeScript support; fast dev server; produces static output |
| API       | textalive-app-api (npm) | Beat, character, phrase, and lyric timing data                      |
| Hosting   | GitHub Pages            | Free static hosting; fits contest static-only requirement           |
| CI/CD     | GitHub Actions          | Auto-deploy on push to `main`                                       |
| Codespace | GitHub Codespaces       | Node.js pre-installed; no local setup needed                        |

---

## File Structure

```
project-root/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← GitHub Actions: build + deploy to gh-pages
├── public/
│   └── (static assets served as-is)
├── src/
│   ├── main.ts                 ← Entry point: creates Player, mounts UI, wires events
│   ├── style.css               ← Global styles, layout, animations
│   ├── types.ts                ← Shared TypeScript interfaces
│   │
│   ├── game/
│   │   ├── scheduler.ts        ← Beat-to-phrase mapping; builds the cue schedule
│   │   ├── scoring.ts          ← Hit detection, rating calculation, score + combo state
│   │   └── singer.ts           ← Singer state machine (idle/happy/great/sad)
│   │
│   └── ui/
│       ├── arrows.ts           ← Cue bar rendering: pre-place arrows, move playhead
│       ├── lyrics.ts           ← Two-row phrase display, per-character color flip
│       └── rating.ts           ← Rating word display and float-up animation
│
├── assets/
│   └── singer/
│       ├── idle.png            ← Singer sprite: default state
│       ├── happy.png           ← Singer sprite: combo ≥ 10 or Perfect hit
│       ├── great.png           ← Singer sprite: combo ≥ 5
│       └── sad.png             ← Singer sprite: Miss or Bad, combo = 0
│
├── index.html                  ← Single HTML shell; structure injected here or by JS
├── vite.config.ts              ← base path set to repo name for GitHub Pages
├── tsconfig.json               ← strict mode
└── package.json
```

---

## Architecture Overview

The app has four layers that communicate in one direction (API → Game → UI → DOM).
There is no shared mutable global state outside of the game engine module.

```
TextAlive App API
  │  Player object, beat events, character timing, phrase timing
  ▼
Game Engine (src/game/)
  │  scheduler.ts  — builds PhraseRow[] and CueEntry[] at load time
  │  scoring.ts    — maintains score, combo, processes hits
  │  singer.ts     — derives singer state from score state
  ▼
UI Layer (src/ui/)
  │  lyrics.ts     — renders two phrase rows, updates clip-path color fill each frame
  │  arrows.ts     — pre-places cue divs on bar, moves playhead div each frame
  │  rating.ts     — replaces arrow with rating word, triggers CSS animation
  ▼
DOM / CSS
     index.html structure + style.css animations
```

### Key Data Flow

1. `onVideoReady` fires → `scheduler.ts` walks beats + characters + phrases →
   produces `PhraseRow[]` (each containing its `CueEntry[]` with pre-calculated
   `barPosition` percentages)
2. `requestAnimationFrame` loop runs every frame:
   - `lyrics.ts` computes playhead progress for the active phrase and updates
     `clip-path: inset(0 X% 0 0)` on the teal text layer — no per-character
     work, one CSS property change per frame
   - `arrows.ts` updates `playhead.style.left` for the active phrase bar
   - `lyrics.ts` checks if position has passed `activePhrase.endTime` → triggers
     phrase advance (swap top/bottom rows, pre-load next phrase)
3. Keypress / touch → `scoring.ts.handleInput(direction)` → rating →
   `rating.ts` displays word → `singer.ts` updates state

### Core Types (`src/types.ts`)

```ts
export type Direction = 'up' | 'down' | 'left' | 'right';

export type RatingType = 'Perfect' | 'Great' | 'Good' | 'Bad' | 'Miss';

export interface CueEntry {
  beatTime: number;             // ms — beat timestamp from API, used for hit detection
  phraseIndex: number;          // index of the phrase this cue belongs to
  barPosition: number;          // 0–100 — left% position on the phrase's cue bar
  direction: Direction;         // randomly assigned at schedule build time
  element: HTMLElement | null;  // the cue <div> on the bar, set when phrase is activated
  timeoutId: number | null;     // miss timeout handle; cleared on successful hit
  resolved: boolean;            // true once rated; prevents double-scoring
}

export interface PhraseRow {
  phrase: IPhrase;                      // TextAlive phrase object
  cues: CueEntry[];                     // all cues belonging to this phrase
  element: HTMLElement | null;          // the phrase-row <div>
  coloredLayer: HTMLElement | null;     // the teal text layer; clip-path updated each frame
  playheadElement: HTMLElement | null;  // the sliding dot <div>
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<RatingType, number>;
}

export type SingerState = 'idle' | 'happy' | 'singing' | 'sad';
```

---

## Implementation Plan

The project is broken into 8 chunks. Each chunk produces something runnable and
testable before the next begins. Chunks 1–3 are complete. Chunk 4 is partially
complete (step 1 done). Steps marked `x` are already implemented.

---

### ✅ Chunk 1 — Project scaffold and build pipeline (complete)

**Goal**: A blank page that builds, runs in Codespace, and deploys to GitHub
Pages without errors.

#### Steps

x 1. Scaffold with `npm create vite@latest . -- --template vanilla-ts`,
     `npm install`, `npm install textalive-app-api`.
x 2. Set `base` in `vite.config.ts` to the repo name for GitHub Pages.
x 3. Remove Vite boilerplate (`counter.ts`, `typescript.svg`, `vite.svg`).
x 4. Replace `index.html` with a minimal dark shell pointing to `src/main.ts`.
x 5. Replace `src/style.css` with base reset (dark background, `height: 100vh`,
     `overflow: hidden`).
x 6. Replace `src/main.ts` with `console.log('scaffold ok')`.
x 7. Verify `npm run dev` shows a blank dark page with no console errors.
x 8. Create `.github/workflows/deploy.yml` (checkout → setup-node →
     `npm install` → `npm run build` with `VITE_TEXTALIVE_TOKEN` env var →
     deploy via `peaceiris/actions-gh-pages@v4`).
x 9. Add `VITE_TEXTALIVE_TOKEN` as a repository Actions secret.
x 10. Set GitHub Pages source to branch `gh-pages`, folder `/ (root)`.
x 11. Push to `main`, confirm Actions passes, confirm deployed page loads.

---

### ✅ Chunk 2 — TextAlive Player initialization (complete)

**Goal**: The TextAlive Player loads a song and logs beat count and character
count to the console.

#### Steps

x 1. Create `src/types.ts` with `Direction`, `RatingType`, `CueEntry`,
     `PhraseRow`, `ScoreState`, and `SingerState` type definitions.
x 2. Instantiate `Player` in `src/main.ts` using `VITE_TEXTALIVE_TOKEN`.
x 3. Add `onAppReady` callback: call `player.createFromSongUrl(...)` with the
     versioned contest URL and explicit `beatId`, `lyricId`, `lyricDiffId`.
x 4. Add `onVideoReady` callback: log beat count and character count.
x 5. Add Play/Pause buttons wired to `player.requestPlay()` /
     `player.requestPause()`.
x 6. Verify console logs show non-zero beat and character counts.
x 7. Add `onAppMediaChange` listener to confirm lifecycle is wired correctly.

---

### ✅ Chunk 3 — Beat-to-character mapping (scheduler) (complete)

**Goal**: `scheduler.ts` produces a `PhraseRow[]` array with pre-calculated
`CueEntry[]` per phrase. Logged and manually verified.

#### Steps

x 1. Create `src/game/scheduler.ts` exporting `buildSchedule(player): PhraseRow[]`.
x 2. Convert `player.video.firstChar` linked list to an array by walking `.next`.
x 3. Convert `player.video.firstPhrase` linked list to an array by walking `.next`.
x 4. Get beats from `player.data.songMap.beats` (verify property name against
     API docs — do not assume).
x 5. For each beat, find a character whose `startTime` is within ±100ms of the
     beat timestamp and has not already been assigned. Skip beats that fall
     within an ongoing character's `startTime`–`endTime` range.
x 6. For matched beats, create a `CueEntry` with a random direction,
     `resolved: false`, and `barPosition` calculated as:
     `(beatTime - phrase.startTime) / (phrase.endTime - phrase.startTime) * 100`
x 7. Group `CueEntry[]` by phrase into `PhraseRow[]`.
x 8. Add helper `randomDirection(): Direction`.
x 9. Call `buildSchedule(player)` in `onVideoReady` and log the result.
x 10. Manually verify 5–10 entries against lyrics and tempo.
x 11. Confirm the "こたえて" chorus 1ms-timing characters are naturally skipped.

---

### ✅ Chunk 4 — HTML layout and static UI shell

**Goal**: The full UI layout is visible with placeholder content. Singer fills
the background. The overlay box with two phrase rows and the input pad are all
in their correct positions. No game logic yet.

**Success criterion**: The page looks correct on both desktop and a 375px mobile
viewport. The singer image is visible above the overlay. The two phrase-row
slots, two cue bar tracks, and four arrow buttons are all present and correctly
positioned.

#### Steps

x 1. Update `index.html` with the full HTML structure:
     - `#hud` — top bar with `#song-title`, `#score`, `#combo`
     - `#stage` — full-height container, `position: relative`
       - `#singer` — `<img>` filling the stage background
       - `#lyric-overlay` — semi-transparent box overlaid on the lower portion
         of the stage, containing:
         - `#phrase-top` — active phrase row (`<div class="phrase-row active">`)
           - `#phrase-top-text` — character `<span>` elements go here
           - `#bar-top` — cue bar track (`<div class="bar-track">`)
         - `#phrase-bottom` — next phrase row (`<div class="phrase-row next">`)
           - `#phrase-bottom-text`
           - `#bar-bottom`
     - `#input-pad` — four directional buttons outside and below the overlay

x 2. In `src/style.css`, implement the layout. The page fills `100vh` with no
   overflow. Suggested proportions:
   - `#hud`: ~8% height, flexbox row, space-between
   - `#stage`: remaining height (~92%), `position: relative`, `overflow: hidden`
   - `#singer`: `position: absolute`, `inset: 0`, `width: 100%`, `height: 100%`,
     `object-fit: cover`, `object-position: center top`, `z-index: 0`
   - `#lyric-overlay`: `position: absolute`, bottom-aligned within `#stage`,
     ~55% of stage height, full width, `background: rgba(0,0,0,0.55)`,
     `backdrop-filter: blur(2px)`, `z-index: 1`, padding `1rem`
   - `#input-pad`: `position: absolute`, bottom of `#stage` or below it,
     four buttons minimum 80×80px, `z-index: 2`

x 3. Style `.phrase-row`: flex column, gap between text and bar track. Style
   `.phrase-row.next`: `opacity: 0.4`. Style `.phrase-row.active`: full opacity.

x 4. Style `.bar-track`: `position: relative`, `height: 32px`,
   `background: rgba(255,255,255,0.15)`, `border-radius: 16px`, full width.
   This is the track the playhead and cues sit on.

5. Add a placeholder singer image (a solid colored rectangle is fine) as `#singer`.

x 6. Add placeholder text in `#phrase-top-text` and `#phrase-bottom-text` using
   two stacked `<div>` elements each: a dim base layer and a teal colored layer
   on top (both containing the same sample Japanese text). Set the colored layer
   to `clip-path: inset(0 40% 0 0)` to preview the partial fill effect.

x 7. Add a placeholder `.playhead` div inside `#bar-top` at `left: 60%` and a
   few placeholder `.cue` divs at various positions to preview bar layout.

x 8. Test on desktop and simulate 375px in DevTools. Adjust until no overflow
   and all elements are visible and correctly sized.

---

### Chunk 5 — Lyric rendering, phrase display, and clip-path color fill

**Goal**: Real lyrics render in the two phrase rows. The active phrase fills
with teal color from left to right in perfect sync with the playhead. The rows
swap correctly as the song progresses.

**Success criterion**: Play the song. The top row shows the current phrase with
teal color filling smoothly from left to right as the playhead moves. The bottom
row shows the next phrase dimly with no fill. When the phrase ends, rows swap
instantly and the next phrase pre-loads. The color fill and the playhead dot
are always at the same horizontal position.

#### Steps

1. Create `src/ui/lyrics.ts` exporting:
   - `initLyrics(phraseRows: PhraseRow[]): void` — builds DOM for all phrases
     upfront and stores element references on each `PhraseRow`
   - `activatePhrase(row: PhraseRow, topSlot: HTMLElement, bottomSlot: HTMLElement, isTop: boolean): void`
     — inserts a phrase row into the correct slot
   - `updateLyrics(activeRow: PhraseRow, position: number): void` — called each
     animation frame; updates `clip-path` on the colored text layer

2. In `initLyrics`, for each `PhraseRow`:
   - Create a `<div class="phrase-row">` and store it on `row.element`.
   - Inside, create a text container `<div class="phrase-text-wrap">` with
     `position: relative`. Inside that, create two divs with identical text
     content (the full phrase text, no per-character splitting needed):
     - `<div class="phrase-dim">` — base layer, dim color (e.g. `rgba(255,255,255,0.3)`)
     - `<div class="phrase-colored">` — teal layer (`color: #1D9E75`),
       `position: absolute`, `inset: 0`, initial `clip-path: inset(0 100% 0 0)`
       (fully hidden). Store this element on `row.coloredLayer`.
   - Create the `.bar-track` div with `position: relative`. Pre-place one
     `<div class="cue">` per `CueEntry` at `style="left: {entry.barPosition}%"`,
     inner text set to the arrow Unicode character. Store each element on
     `entry.element`. Add a `<div class="playhead">` and store it on
     `row.playheadElement`.
   - Do **not** append phrase rows to the DOM yet — they are activated on demand.

3. In `updateLyrics`, compute progress and update the clip:
   ```ts
   export function updateLyrics(activeRow: PhraseRow, position: number): void {
     const { phrase, coloredLayer } = activeRow;
     if (!coloredLayer) return;
     const progress = (position - phrase.startTime)
                    / (phrase.endTime - phrase.startTime);
     const pct = Math.min(Math.max(progress * 100, 0), 100);
     // reveal teal layer left-to-right: clip away the right portion
     coloredLayer.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
   }
   ```
   This is the only DOM update needed per frame for lyrics — one CSS property.

4. In `main.ts`, after `buildSchedule`, call `initLyrics(phraseRows)`. Maintain
   two index variables: `activeIndex` (top row) and `nextIndex` (bottom row).
   Call `activatePhrase` for index 0 (top slot) and index 1 (bottom slot)
   immediately after `onVideoReady`.

5. In the `requestAnimationFrame` loop, call `updateLyrics` for the active row,
   then check for phrase advance:
   - If `player.timer.position >= phraseRows[nextIndex].phrase.startTime`:
     - Increment both indices.
     - Swap DOM: move current active row out, current next row into top slot.
     - Call `activatePhrase` for the new `nextIndex` row into the bottom slot.
     - Reset the newly-active row's `coloredLayer.style.clipPath` to
       `inset(0 100% 0 0)` to ensure a clean fill start with no leftover state.

6. Add CSS for the two text layers:
   ```css
   .phrase-text-wrap {
     position: relative;
     font-size: 2rem;
     line-height: 1.4;
     white-space: nowrap;
   }
   .phrase-dim {
     color: rgba(255, 255, 255, 0.3);
   }
   .phrase-colored {
     position: absolute;
     inset: 0;
     color: #1D9E75;
     /* clip-path updated each frame — no transition, intentionally */
   }
   .playhead {
     position: absolute;
     width: 16px;
     height: 16px;
     border-radius: 50%;
     background: white;
     top: 50%;
     transform: translate(-50%, -50%);
     pointer-events: none;
   }
   .cue {
     position: absolute;
     transform: translateX(-50%);
     font-size: 1.4rem;
     top: 50%;
     transform: translate(-50%, -50%);
     pointer-events: none;
   }
   ```

7. Test: play the song. Verify the teal fill and the playhead dot always sit at
   exactly the same horizontal position. Verify the bottom row is fully dim with
   no fill. Verify the phrase swap resets the fill cleanly with no leftover teal
   from the previous phrase. Verify seeking backwards (if supported) clears the
   fill correctly due to the `Math.max(progress, 0)` clamp.

---

### Chunk 6 — Playhead animation and miss detection

**Goal**: The playhead slides across the active bar in real time. Arrow cues
auto-resolve to "Miss" if not pressed.

**Success criterion**: Play without pressing anything for 30 seconds. The
playhead moves smoothly. Each arrow cue is replaced by a red "Miss" label that
floats up and fades. No miss fires during the next (dim) phrase.

#### Steps

1. In the `requestAnimationFrame` loop in `main.ts`, update the playhead
   position each frame for the active phrase:
   ```ts
   const phrase = phraseRows[activeIndex].phrase;
   const progress = (position - phrase.startTime)
                  / (phrase.endTime - phrase.startTime);
   row.playheadElement.style.left =
     Math.min(Math.max(progress * 100, 0), 100) + '%';
   ```

2. Create `src/ui/rating.ts` exporting:
   - `RATING_COLORS: Record<RatingType, string>` — color map for all five ratings
   - `RATING_LABELS: Record<RatingType, string>` — display strings
   - `resolveCue(entry: CueEntry, rating: RatingType): void` — replaces arrow
     with rating word, triggers animation, schedules DOM removal

3. In `resolveCue`:
   - Guard: if `entry.resolved` is `true`, return immediately.
   - Set `entry.resolved = true`.
   - Replace `entry.element` text content with the rating label.
   - Set the element's color to `RATING_COLORS[rating]`.
   - Add CSS class `cue-resolved` which triggers the float-up animation.
   - After 600ms (`setTimeout`), remove the element from the DOM.

4. Create `src/ui/arrows.ts` exporting:
   - `armCues(row: PhraseRow): void` — sets miss timeouts for all cues in a
     phrase row when that row becomes active

5. In `armCues`, for each unresolved cue in `row.cues`:
   - Calculate the time remaining until the miss window closes:
     `delay = (cue.beatTime - player.timer.position) + 300` (250ms window + 50ms buffer)
   - Set `cue.timeoutId = setTimeout(() => resolveCue(cue, 'Miss'), delay)`

6. Call `armCues(row)` whenever a phrase row is activated (in the phrase-advance
   logic from Chunk 5).

7. Add CSS `@keyframes ratingPop`:
   ```css
   @keyframes ratingPop {
     0%   { transform: translateX(-50%) translateY(0);    opacity: 1; }
     100% { transform: translateX(-50%) translateY(-36px); opacity: 0; }
   }
   .cue-resolved { animation: ratingPop 600ms ease-out forwards; }
   ```
   Add color classes `.rating-perfect`, `.rating-great`, etc.

8. Test: play without pressing. Confirm every arrow becomes "Miss". Confirm the
   next (dim) phrase's arrows do not fire early. Confirm the playhead stays
   within the bar bounds (clamp at 0% and 100%).

---

### Chunk 7 — Input handling and scoring

**Goal**: Pressing the correct arrow key or button at the right time produces
a rating. Score and combo update on screen.

**Success criterion**: Play the song and press arrow keys. Correct presses in
time produce Perfect/Great/Good/Bad. Wrong-direction presses are ignored. Combo
resets on Bad and Miss. Score increments correctly.

#### Steps

1. Create `src/game/scoring.ts` exporting a `ScoreManager` class with:
   - `state: ScoreState`
   - `handleInput(direction: Direction, now: number, activeRow: PhraseRow): void`
   - `applyRating(rating: RatingType): void`

2. In `handleInput`:
   - Find the first unresolved cue in `activeRow.cues` whose `beatTime` is
     within `[now - 250, now + 250]`. If none found, return (stray press).
   - If `cue.direction !== direction`, return (wrong direction — miss timeout
     handles it naturally).
   - If direction matches, compute `delta = Math.abs(now - cue.beatTime)` and
     assign rating:
     - `delta <= 50`  → Perfect
     - `delta <= 100` → Great
     - `delta <= 150` → Good
     - `delta <= 250` → Bad
   - Call `clearTimeout(cue.timeoutId)` to cancel the miss timer.
   - Call `resolveCue(cue, rating)` to display the rating word.
   - Call `applyRating(rating)` to update score state.

3. In `applyRating`:
   - Add points: Perfect +300, Great +200, Good +100, Bad +50, Miss +0.
   - Increment `combo` for Perfect/Great/Good; reset to 0 for Bad/Miss.
   - Update `maxCombo` if `combo > maxCombo`.
   - Increment `counts[rating]`.
   - Dispatch a custom DOM event `scoreupdate` with the new state as detail,
     so the HUD and singer can react without `scoring.ts` knowing about the DOM:
     ```ts
     document.dispatchEvent(new CustomEvent('scoreupdate', { detail: this.state }));
     ```

4. Add keyboard listener in `main.ts`:
   ```ts
   document.addEventListener('keydown', (e) => {
     const map: Record<string, Direction> = {
       ArrowUp: 'up', ArrowDown: 'down',
       ArrowLeft: 'left', ArrowRight: 'right'
     };
     if (map[e.key]) {
       e.preventDefault(); // stop page scroll on arrow keys
       scoreManager.handleInput(map[e.key], player.timer.position,
                                phraseRows[activeIndex]);
     }
   });
   ```

5. Add `click` and `touchstart` listeners on the four `#input-pad` buttons,
   each calling `handleInput` with the appropriate direction. Use `touchstart`
   (not `click`) for lower latency on mobile. Call `e.preventDefault()` on
   touch events to avoid double-firing.

6. Listen for `scoreupdate` in `main.ts` and update `#score` and `#combo`
   text content in the HUD.

7. Test: play and press keys. Verify each timing window produces the correct
   rating. Verify stray presses do nothing. Verify wrong-direction presses
   do nothing and the miss still fires. Verify combo resets on Bad and Miss.

---

### Chunk 8 — Singer state machine and polish

**Goal**: The singer sprite reacts to score state. The game has a start screen
and an end screen. The app is ready for submission.

**Success criterion**: Full playthrough works end-to-end. Singer changes
expression visibly. Results are shown at song end. Works on mobile and desktop.

#### Steps

1. Create `src/game/singer.ts` exporting:
   - `getSingerState(state: ScoreState, lastRating: RatingType | null): SingerState`

2. Implement state logic:
   - `idle`: no `lastRating` yet (before first cue)
   - `happy`: `lastRating === 'Perfect'` or `combo >= 10`
   - `great`: `combo >= 5` and `combo < 10`
   - `sad`: `lastRating === 'Miss'` or `lastRating === 'Bad'` or `combo === 0`
   - Default (otherwise): `great` or `happy` based on combo threshold

3. In `main.ts`, listen for `scoreupdate`. On each event, call `getSingerState`
   and update `<img id="singer">` src to the matching asset path. If the state
   changed, add CSS class `singer-bounce` to the img and remove it after the
   animation ends (`animationend` event listener, `{ once: true }`).

4. Add singer sprite images to `assets/singer/`. Use clearly labeled placeholder
   colored rectangles if final art is not ready — swap in real art later. The
   images should be portrait-oriented so `object-fit: cover` keeps the face
   visible.

5. Add CSS for singer bounce:
   ```css
   @keyframes singerBounce {
     0%   { transform: scale(1); }
     50%  { transform: scale(1.04); }
     100% { transform: scale(1); }
   }
   .singer-bounce { animation: singerBounce 200ms ease-out; }
   ```

6. Add a start screen overlay (`#screen-start`) shown before playback begins:
   - Display the game title, song name, and "Tap to start" prompt.
   - Optionally show song selection if multiple songs are implemented.
   - On click/tap: hide the overlay, call `player.requestPlay()`.

7. Add an end screen overlay (`#screen-end`) hidden initially:
   - Show: total score, max combo, and a breakdown of each rating count.
   - Add a "Play again" button that calls `location.reload()`.

8. Wire `player.addListener({ onStop: () => showEndScreen(scoreManager.state) })`.

9. Final responsive check: simulate iPhone SE (375×667) in DevTools. Verify
   buttons are tappable, lyrics are readable, singer is visible above the
   overlay, no overflow.

10. Final accessibility pass:
    - Add `aria-label` to all four input buttons (e.g. `aria-label="Up"`).
    - Ensure `<html lang="ja">` and a descriptive `<title>` are set.

11. Run `npm run build` and verify the `dist/` output. Serve locally with
    `npx serve dist` and confirm asset paths and the token env var work
    correctly in the production build.

12. Push to `main`. Confirm GitHub Actions deploys successfully. Test the live
    GitHub Pages URL on both desktop and a real mobile device.

---

## Timing Reference

| Chunk                      | Status      | Estimated time  |
|----------------------------|-------------|-----------------|
| 1 — Scaffold               | ✅ Complete  | —               |
| 2 — Player init            | ✅ Complete  | —               |
| 3 — Scheduler              | ✅ Complete  | —               |
| 4 — UI layout              | 🔄 In progress (step 1 done) | ~1 day remaining |
| 5 — Lyric rendering        | Not started | 2 days          |
| 6 — Playhead + miss        | Not started | 2 days          |
| 7 — Input + scoring        | Not started | 2–3 days        |
| 8 — Singer + polish        | Not started | 3–4 days        |
| Singer art (parallel)      | Not started | 1 week          |
| Buffer / bug fixing        | —           | 3–4 days        |

**Remaining: ~2.5–3 weeks of focused part-time work.**

Start singer art immediately in parallel — it is the only deliverable that
cannot be accelerated with code and is the biggest scheduling wildcard.

---

## Important Constraints and Reminders

- Singer art must not be AI-generated (contest rule). Start early.
- The TextAlive app token must not be committed to the repository. Use
  `VITE_TEXTALIVE_TOKEN` as a Vite env variable, loaded from GitHub Actions
  secrets in CI and from a Codespace secret in development.
- The repository must remain **private** until judging is complete. Do not
  publish demo videos or screenshots before the submission deadline.
- After the submission deadline, do not push any commits until prize-winning
  entries are announced — the final commit at the deadline is what is judged.
- Use the versioned song URLs with explicit `beatId`, `lyricId`, and
  `lyricDiffId` values from the contest support page to ensure timing data
  does not change during judging.
- The Grand Prize song "こたえて" has chorus characters with artificially short
  (1ms) timing. The scheduler naturally skips these — confirmed in Chunk 3.
- Always verify API method and property names against the live documentation at
  `https://developer.textalive.jp/packages/textalive-app-api/modules.html`
  before using them. Do not assume property names from memory.
- `IPhrase` boundaries may not always feel like natural "lines" for every song.
  Verify phrase lengths look reasonable during Chunk 5 testing. If a phrase is
  very short (1–2 characters), consider grouping adjacent phrases — but only if
  the API data justifies it.
