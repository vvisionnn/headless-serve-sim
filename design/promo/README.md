# Promo film

The 60-second film at the top of the project README, cut once for a light
page and once for a dark one. It is code, not footage: a React composition
built from the Stage design itself (the device artwork, glass materials,
tokens and panels from `../src`) and real simulator screens, scored in the
browser and rendered frame by frame in headless Chromium.

```sh
mise run promo           # render both cuts into renders/ (see below)
mise run promo:preview   # rebuild on change; play it at http://localhost:4310/dist/promo.html
mise run promo:capture   # macOS only: re-capture the simulator screens in assets/
```

`mise run promo` brings its own ffmpeg and libwebp (via mise) and Playwright's
headless Chromium (via bun), so it works on any machine with mise. The film
uses SF Pro and SF Mono when the machine has them, and the system fallbacks
otherwise. In the player, <kbd>Space</kbd> plays and pauses with sound,
<kbd>←</kbd> <kbd>→</kbd> step a frame (hold <kbd>⇧</kbd> for a second),
`?t=12.5` opens at a time, and `?scheme=light` plays the light cut.

| Output                            | What it is                                     |
| --------------------------------- | ---------------------------------------------- |
| `headless-serve-sim-<scheme>.mp4` | 1920×1080, 60 fps, H.264 with the AAC score    |
| `readme-<scheme>.webp`            | 960×540, 20 fps, animated; what the README shows |
| `poster-<scheme>.png`             | 1920×1080, the closing frame                   |

`bun run promo/render.ts dark` renders one cut only.

## How it is made

- **Real pixels.** Every screen is a capture from a fresh simulator on Apple's
  default wallpaper at 9:41, framed in Simulator's own device artwork. The
  accessibility boxes in the console are the real tree of the captured Settings
  screen. `scripts/capture.ts` makes its own simulators, answers first-boot
  prompts, waits for widgets to settle, and deletes the simulators afterwards.
- **A real unfold.** The iPhone Duo opens through its own hinge: the capture
  sweeps the hinge from 180° to 0° in 5° steps as headless-serve-sim's Stage
  draws it (`assets/duo-fold/`, `fold.json`), and the film plays the nearest
  frame for each angle. `capture.ts --duo-only` re-captures just that sweep.
- **One take.** The iPhone that slams out of the dark is the same object
  throughout: it sheds its window, docks into the Stage, records itself, joins
  the wall, takes commands, and hands the frame to the wordmark.
  `src/film/cues.ts` is the edit, in beats.
- **Two schemes, one motion.** `src/film/scheme.ts` reads `?scheme=`; the room
  sweeps to the other appearance with the Stage's own toggle and back for the
  terminal. Nothing else differs between the cuts.
- **A pure function of time.** Every value on screen is computed from the
  playhead (`src/lib/time.ts`), so any frame renders the same on every run.
  `src/env.ts` freezes the clocks and randomness the borrowed Stage components
  use.
- **Its own score.** `src/score/score.ts` synthesizes the music and every
  sound effect in an `OfflineAudioContext` from the same cues as the picture,
  120 BPM in D major: each click, keystroke, log line, toast, landing, hinge
  and shutter sounds on its frame.

| Path                    | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `src/film/film.tsx`     | The film: rooms, appearance sweeps, camera, grain, the hero device |
| `src/film/acts/*.tsx`   | The acts, from the cold open to the wordmark                       |
| `src/film/cues.ts`      | Every cue, and the commands typed on screen                        |
| `src/film/layout.ts`    | Where the hero device is at any time, and the wall's layout        |
| `src/film/scheme.ts`    | The cut's colour scheme                                            |
| `src/score/score.ts`    | The score and its sound effects                                    |
| `assets/`               | The captured screens, Duo fold, AX tree and device artwork         |
| `scripts/capture.ts`    | Re-captures `assets/` from simulators                              |
| `build.ts`              | Builds `dist/promo.html` and serves it                             |
| `render.ts`             | Captures every frame, then encodes the outputs with ffmpeg         |
