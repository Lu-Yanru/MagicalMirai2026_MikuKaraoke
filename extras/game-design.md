# Rhythm Lyric Game — Design Summary

A web-based rhythm game built with the TextAlive App API for the Hatsune Miku
"Magical Mirai 2026" Programming Contest. The player presses directional arrow
buttons in time with the beat while karaoke-style lyrics display on screen and
a singer character reacts to the player's performance.

---

## Concept

As a designated contest song plays, two lines of Japanese lyrics are visible at
all times. The active (top) line fills with color from left to right in sync
with a moving playhead, like a real karaoke display. Below each line of lyrics
sits a horizontal cue bar with arrow icons (↑ ↓ ← →) pre-placed at beat
positions. A playhead dot slides across the bar from left to right. The color
fill of the lyrics tracks the playhead exactly — text to the left of the
playhead is bright teal, text to the right is dim. The player must press the
matching arrow key (or tap the matching on-screen button) as the playhead passes
each arrow. A singer character fills the background and reacts to the player's
combo and score.

---

## Designated Songs

The player can choose from the 6 songs designated by the contest:

- **こたえて** — imie (Grand Prize)
- **アフター・ザ・カーテン** — Rulmry
- **シャッターチャンス** — 夜未アガリ
- **世界最後の音楽隊** — 夏山よつぎ × ど～ぱみん
- **トリツクロジー** — 鶴三
- **TAKEOVER** — Twinfield

---

## Core Mechanics

### Lyric Display

Two phrase rows are visible at all times inside a semi-transparent overlay box:

- **Top row (active phrase)**: the phrase currently being sung. The text is
  rendered twice in the same position — a dim layer underneath and a bright teal
  layer on top. The teal layer is clipped to reveal only the portion to the left
  of the playhead, using CSS `clip-path: inset(0 X% 0 0)` updated every
  animation frame. As the playhead moves right, more of the teal text is
  revealed, creating a smooth incremental color fill that stays perfectly in sync
  with the bar. No per-character timing is used for the color effect — the
  playhead position alone drives it.
- **Bottom row (next phrase)**: the upcoming phrase, displayed dimly so the
  player can read ahead. Its cue bar is visible but its playhead is not yet
  active and no color fill is shown.

When the song advances to the next phrase, the top row swaps to what was the
bottom row (now active), and the bottom row pre-loads the phrase after that.
The swap is instantaneous — a CSS class toggle, no scroll animation.

Note: `IChar` timing data is still used by the scheduler to avoid placing arrow
cues mid-character on held notes. It is not used for the visual color fill.

### Cue Bars

Below each phrase row sits a horizontal cue bar. For the active phrase:

- Arrow cues (↑ ↓ ← →) are pre-placed at fixed horizontal positions along the
  bar, calculated at load time as a percentage of the phrase's total duration.
  All arrows for the phrase are visible at once so the player can see what is
  coming.
- A playhead dot slides from left (phrase start) to right (phrase end) on every
  animation frame, driven by the current playback position.
- The arrow direction for each beat is randomly assigned at load time.

For the next phrase row the cue bar is rendered identically but dimmed — the
player can preview upcoming arrows.

### Beat-to-Phrase Mapping

At load time (`onVideoReady`), a schedule is built by walking the beat list and
the character list together:

- A beat receives an arrow cue only if a character **starts** within ±100ms of
  that beat timestamp.
- Beats that fall within the duration of an ongoing character (between its
  `startTime` and `endTime`) are skipped — no cue is generated.
- This ensures no two cues share the same character and no cue appears
  mid-character on a held note.

Each cue entry records: `beatTime`, `phraseIndex`, `barPosition` (0–100%
along the bar), `direction`, and `resolved` state.

### Input

- **Keyboard**: arrow keys (↑ ↓ ← →)
- **Touch / mouse**: four large tap zones at the bottom of the screen

### Timing Windows and Ratings

Each arrow cue has a hit window of ±250ms around the beat timestamp:

| Rating  | Condition                              | Combo effect | Color  |
|---------|----------------------------------------|--------------|--------|
| Perfect | correct direction, within ±50ms        | +1 combo     | Blue   |
| Great   | correct direction, within ±100ms       | +1 combo     | Green   |
| Good    | correct direction, within ±150ms       | +1 combo     | Yellow  |
| Bad     | correct direction, within ±250ms       | reset to 0   | Purple   |
| Miss    | wrong direction, or no press in window | reset to 0   | Red    |

- A **wrong-direction press** is ignored entirely. The miss timeout fires
  naturally when the window expires and resolves the cue as Miss.
- A **stray press** (no active cue) is ignored and does not affect score or combo.

### Rating Word Display

When a cue resolves (player press or miss timeout), the arrow icon in the cue
`<div>` is replaced by the rating word ("Perfect", "Great", etc.) in the
matching color. The rating word floats upward and fades out over ~600ms via a
CSS keyframe animation. The miss timeout fires at 250ms + 50ms buffer so the
resolution feels conclusive rather than cut off.

### Scoring

| Rating  | Points |
|---------|--------|
| Perfect | 300    |
| Great   | 200    |
| Good    | 100    |
| Bad     | 50     |
| Miss    | 0      |

A combo multiplier applies to Perfect and Great. Score and current combo are
displayed in the HUD at all times.

---

## Singer Character

A hand-drawn character sprite (not AI-generated, per contest rules) fills the
background of the stage area and reacts to the player's performance.

### States

| State | Trigger condition                         |
|-------|-------------------------------------------|
| Idle  | Before song starts                        |
| Happy | Last rating was Perfect, or combo ≥ 10    |
| Singing | Combo ≥ 5 and < 10                        |
| Sad   | Last rating was Miss or Bad, or combo = 0 |

### Implementation

- 3–5 static illustration states as PNG or SVG files.
- The singer `<img>` is `position: absolute`, fills the stage zone behind the
  overlay box, and uses `object-fit: cover` / `object-position: center top` so
  the singer's face and upper body are always visible above the overlay.
- State swaps are `img.src` changes triggered by the `scoreupdate` event.
- A brief CSS scale bounce animation plays on every state change.
- The semi-transparent lyric overlay sits on top via `z-index`. The singer is
  visible through and above the overlay at all times.
- **All character art must be drawn by the developer or used with explicit
  artist permission. AI-generated images are prohibited by the contest rules.**

---

## UI Layout

```
┌─────────────────────────────────────────────┐
│  HUD: song title         Score    Combo  8% │
├─────────────────────────────────────────────┤
│                                             │
│  [Singer sprite — large, fills background]  │
│                                        92%  │
│  ┌─────────────────────────────────────┐    │
│  │  semi-transparent overlay      ~55% │    │
│  │                                     │    │
│  │  「active phrase text」             │    │
│  │   teal fill tracks the playhead     │    │
│  │  ↑    →       ↓        ↑           │    │
│  │  ────●──────────────────────────── │    │  ← playhead moves right
│  │                                     │    │
│  │  「next phrase text」  (dim)        │    │
│  │  →       ↑   ↓             →      │    │
│  │  ──────────────────────────────── │    │  ← static (not yet active)
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐   │
│  │  ←   │  │  ↓   │  │  ↑   │  │  →   │   │  22%
│  └──────┘  └──────┘  └──────┘  └──────┘   │
└─────────────────────────────────────────────┘
```

- The singer sprite fills the background; the overlay covers the lower portion
  so the singer's face is always visible above it.
- The four touch buttons at the bottom are large tap targets (min 80×80px),
  always visible and outside the overlay.
- On desktop, keyboard arrow keys are the primary input; buttons serve as
  visual reference.
- No scrolling — the two-row phrase display is always at the same fixed
  position on screen.

---

## Technical Constraints

- Static application only — no server-side code.
- Built with Vite + TypeScript, compiled to static HTML/CSS/JS.
- Deployed to GitHub Pages via GitHub Actions.
- Uses the TextAlive App API (`textalive-app-api` npm package).
- No AI-generated assets (images, text, music).
- Source code must be readable — no obfuscation.
- Repository must remain private until judging is complete.
