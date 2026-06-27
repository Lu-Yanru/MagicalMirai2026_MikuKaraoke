# Miku Karaoke

[Play it here](https://lu-yanru.github.io/MagicalMirai2026_MikuKaraoke/)

[Demo video](https://youtu.be/TseMhS2m2hs)

Supported platforms: Desktop, Tablet, Mobile

Tested browsers: Chrome, Safari, Firefox, Microsoft Edge, Brave

## Introduction

Miku Karaoke is a rhythm game built on top of the lyrics and beat data from the
TextAlive App API. As the song plays, the current line of lyrics fills in with
color karaoke-style, in sync with the music. Below the lyrics, arrow cues
(↑ ↓ ← →) appear on a timeline bar, placed on the beat. The player presses the
matching arrow key (or taps the on-screen button) at the right moment to score
points. Hitting cues more precisely (closer to the beat) gives a higher rating 
(Perfect, Great, Good, or Bad), and chaining correct hits builds a combo for
extra score. Missing a cue, or letting it run out, breaks the combo.

Throughout the song, a hand-drawn Hatsune Miku character reacts to how well
the player is doing — shaking her head and her arms along to the beat,
looking happy on a high combo, and looking sad after a miss — 
so it feels like singing karaoke
together with her rather than playing against a static UI.

At the end of the song, the player gets a results screen with their final
score, a percentage of the maximum possible score, a letter rating (S to D),
a breakdown of how many Perfect/Great/Good/Bad/Miss hits they got, their
best combo of the run, and whether the current score beats the highest score saved
on this browser's site data.

The player can pick from the four contest-designated songs sung by Hatsune Miku 
from a song select screen before starting.

### Scheduler algorithm

Normally rhythm-game charts (the timing and pattern of cues) are created by
hand. Since this project needed several songs done in a
short amount of time, the cue placement is generated automatically from the
TextAlive beat data instead, using a 4-step algorithm (see
`src/game/scheduler.ts` and `extras/game-design.md` for the full breakdown):

1. **Eligibility filter** — only beats with enough lead-in time after the
   phrase starts, and not the last "anticipatory" beat of a bar, are
   considered as candidates for a cue.
2. **Density targeting** — how many cues a phrase gets depends on how many
   eligible beats it has (longer/busier phrases get more cues, short ones get
   fewer or none).
3. **Phase rotation** — which beat position is preferred (downbeat, half-bar,
   or backbeat) rotates every couple of phrases, so cues don't always land on
   the same spot in the bar and feel repetitive.
4. **Spacing enforcement** — no two cues in the same phrase are allowed closer
   together than a minimum gap, so it never feels like button-mashing.

The *position* of each cue on the timeline is fixed by this algorithm (so the
chart is consistent and players can learn and improve), but the *arrow
direction* assigned to each cue is randomized every time the song loads, so
the chart layout stays predictable while each individual playthrough still
feels a little different. This improves replayablity but also stays predictable
so players are motivated to improve on the game.

## How to run

1. Clone the repository.
2. Copy `.env.example` to `.env.local` and put a TextAlive App API developer
   token in it (`VITE_TEXTALIVE_TOKEN=...`). Get a token at
   https://developer.textalive.jp/.
3. `npm install`
4. `npm run dev` — opens a local dev server.
5. Open the local url in your browser.

## Architecture

```
project-root/
├── index.html                     ← page shell: HUD, stage, input pad, start/end/loading screens
├── vite.config.ts                 ← Vite config
├── src/
│   ├── main.ts                    ← entry point: TextAlive Player setup, render loop, event wiring
│   ├── style.css                  ← all layout, animation, and theming
│   ├── types.ts                   ← shared TypeScript types (CueEntry, PhraseRow, ScoreState, etc.)
│   ├── app-height.ts              ← measure the actual viewport size and scale index elements accordingly
│   │
│   ├── game/                      ← game logic, no DOM access
│   │   ├── scheduler.ts           ← builds the beat-based cue schedule (see above)
│   │   ├── scoring.ts             ← hit detection, rating, score/combo state
│   │   ├── highescore.ts          ← save and retrieve high score
│   │   ├── singer.ts              ← maps score state to a singer expression
│   │   ├── song.ts                ← song catalog + currently selected song
│   │   └── end-screen.ts          ← score → percentage → letter-rating math
│   │
│   └── ui/                        ← DOM rendering and input handling
│       ├── lyrics.ts              ← two-row phrase display, per-character karaoke color fill
│       ├── arrows.ts              ← arming/disarming miss timeouts for cues
│       ├── rating.ts              ← rating-word display + float-up animation
│       ├── singer-animation.ts    ← beat-driven head/pigtail/arm/mouth animation
│       ├── singer-expression.ts   ← which singer head image to show, and when
│       ├── vocal-presence.ts      ← smooths out the "is she singing right now" signal
│       ├── start-screen.ts        ← song-select screen + How to Play modal
│       ├── loading-screen.ts / loading-controls.ts ← loading overlay + input lockout
│       ├── end-screen-render.ts   ← populates and shows the results screen
│       ├── input-controller.ts    ← keyboard + touch/click input wiring
│       ├── fullscreen.ts          ← fullscreen toggle button(s)
│       └── dom-refs.ts            ← shared DOM element lookups
│
└── src/assets/                    ← hand-drawn art (singer parts, arrow icons, UI icons)
```

Data flows in one direction:

```
TextAlive App API  →  src/game/  (scheduling, scoring, singer logic)
                    →  src/ui/   (DOM rendering, animation, input)
                    →  DOM / CSS
```

`main.ts` is the only file that owns the TextAlive `Player` instance and the
`requestAnimationFrame` render loop; every other module is either pure logic
(`game/`) or DOM-only rendering with no API dependency (`ui/`). The code is
commented chunk-by-chunk throughout — see the file headers in each module for
what it's responsible for and why specific implementation choices were made.

## Declaration

This project is a submission to the
[Hatsune Miku "Magical Mirai 2026" Programming Contest](https://magicalmirai.com/2026/procon/index_en.html),
built on the [TextAlive App API](https://developer.textalive.jp/).

- AI (Claude Sonnet 4.6) was used to help write the code.
- All art (the singer character and her different expressions, arrow icons, UI
  icons) is hand-drawn by myself.
