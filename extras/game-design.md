# Rhythm Lyric Game — Design Summary

A web-based rhythm game built with the TextAlive App API for the Hatsune Miku "Magical Mirai 2026" Programming Contest. The player presses directional arrow buttons in time with the beat while karaoke-style lyrics scroll on screen. A singer character reacts to the player's performance.

---

## Concept

The app is a lyric-driven rhythm game. As a designated contest song plays, lyrics scroll across the screen and light up character by character in karaoke style. On each beat that aligns with the start of a new lyric character, a directional arrow cue (↑ ↓ ← →) appears. The player must press the matching arrow key (or tap the matching on-screen button) within a timing window. A singer character animates in response to the player's score and combo.

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

- Lyrics are displayed phrase by phrase and scroll automatically as the song progresses.
- Each character lights up (color flip) at the exact moment it is sung, driven by `IChar.startTime` from the TextAlive API.
- The color flip is per-character, not a smooth gradient fill — simpler to implement and still visually clear.
- A character that spans multiple beats (common in Japanese) stays lit until its `endTime`. No new arrow cue is spawned for beats that fall within an ongoing character.

### Arrow Cues

- On each beat that coincides with the *start* of a new lyric character (within ±100ms), an arrow cue appears overlaid on that character.
- The arrow direction (↑ ↓ ← →) is randomly assigned at load time during beat-to-character mapping.
- Only one arrow cue is active at a time per beat.
- The cue is represented by a single `<div>` that is reused for both the arrow display and the subsequent rating word.

### Input

- **Keyboard**: arrow keys (↑ ↓ ← →)
- **Touch / mouse**: four large tap zones on screen arranged as a directional pad, suitable for both mobile and desktop pointer input

### Timing Windows and Ratings

Each arrow cue has a hit window of ±250ms around the beat timestamp. Within that window, the player's timing is rated:

| Rating  | Timing window (correct direction) | Combo effect | Display color |
|---------|-----------------------------------|--------------|---------------|
| Perfect | within ±50ms  | +1 combo     | Blue          |
| Great   | within ±100ms | +1 combo     | Green          |
| Good    | within ±150ms | +1 combo     | Yellow         |
| Bad     | within ±250ms | reset to 0   | Purple          |
| Miss    | no press, or wrong direction      | reset to 0   | Red           |

- A press with the **wrong direction** is ignored by the scoring system. The miss timeout fires naturally when the window expires.
- A **stray press** (no active cue) is ignored entirely and does not affect score or combo.

### Rating Word Display

- When a cue resolves (either by a player press or by the miss timeout expiring), the arrow character in the cue `<div>` is replaced by the rating word (e.g. "Perfect", "Miss").
- The rating word floats upward and fades out over approximately 600ms using a CSS keyframe animation.
- On a Miss (no press), the arrow is replaced by "Miss" using the same animation.
- The miss timeout fires at ±250ms + 50ms buffer to ensure it feels conclusive rather than cut off.

### Scoring

- Each rating awards points (exact values to be tuned during implementation):
  - Perfect: 300 pts
  - Great: 200 pts
  - Good: 100 pts
  - Bad: 50 pts
  - Miss: 0 pts
- A combo multiplier applies to Perfect and Great ratings.
- Score and current combo are displayed on screen at all times.

---

## Singer Character

A character sprite (hand-drawn, not AI-generated, per contest rules) is displayed on screen and reacts to the player's performance.

### States

| State | Trigger condition |
|-------|------------------|
| Idle  | Before song starts, or between phrases |
| Happy | Combo ≥ 10, or on a Perfect hit |
| Great | Combo ≥ 5 |
| Sad   | On a Miss or Bad, or combo = 0 |
| Fail  | Combo broken after a long streak (optional, can be merged with Sad) |

### Implementation

- 3–5 static illustration states as image files (PNG or SVG).
- State swaps are driven by CSS class changes on a single `<img>` element.
- A brief CSS transition (scale bounce or opacity fade) plays on every state change.
- **Important**: all character art must be either drawn by the developer or used with explicit permission from the original artist. AI-generated images are prohibited by the contest rules.

---

## UI Layout

```
┌─────────────────────────────────────────┐
│  Song title            Score   Combo    │
│                                         │
│  ┌───────────┐                          │
│  │  Singer   │   ← → ↑ ↓  (cue area)  │
│  │  sprite   │                          │
│  └───────────┘                          │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │   Lyric scroll area                 ││
│  │   (characters light up as sung)     ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │  ←   │ │  ↓   │ │  ↑   │ │  →   │  │
│  └──────┘ └──────┘ └──────┘ └──────┘  │
└─────────────────────────────────────────┘
```

- The four touch buttons at the bottom are large tap targets, suitable for mobile.
- The lyric area auto-scrolls to keep the current phrase visible.
- The singer sprite and cue area share the upper portion of the screen.
- On desktop, keyboard arrow keys are the primary input; buttons remain visible as reference.

---

## Technical Constraints

- Static application only — no server-side code. Runs by placing files on an HTTP server.
- Built with Vite + TypeScript, compiled to static HTML/CSS/JS.
- Deployed to GitHub Pages via GitHub Actions.
- Uses the TextAlive App API (loaded via npm package `textalive-app-api`).
- No AI-generated assets (images, text, music) in the output.
- Source code must be readable — no obfuscation.
- Repository must remain private until judging is complete.
