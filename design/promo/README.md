# Promo film

The 40-second film at the top of the project README. It is code, not footage:
a React composition built from the Stage design itself (the device artwork,
glass materials, tokens and panels from `../src`) and real simulator screens,
scored in the browser and rendered frame by frame in headless Chromium.

```sh
mise run promo           # render: renders/headless-serve-sim.mp4 (with sound), readme.webp, poster.png
mise run promo:preview   # rebuild on change; play it at http://localhost:4310/dist/promo.html
mise run promo:capture   # macOS only: re-capture the simulator screens in assets/
```

`mise run promo` brings its own ffmpeg and libwebp (via mise) and Playwright's
headless Chromium (via bun), so it works on any machine with mise. The film
uses SF Pro and SF Mono when the machine has them, and the system fallbacks
otherwise. In the player, <kbd>Space</kbd> plays and pauses with sound,
<kbd>←</kbd> <kbd>→</kbd> step a frame (hold <kbd>⇧</kbd> for a second), and
`?t=12.5` opens at a time.

## How it is made

- **Real pixels.** Every screen is a capture from a fresh simulator on Apple's
  default wallpaper at 9:41, framed in Simulator's own device artwork; the Duo
  is captured as headless-serve-sim's Stage draws it. The accessibility boxes in
  act V are the real tree of the captured Settings screen. `scripts/capture.ts`
  makes its own simulators, answers first-boot prompts, waits for widgets to
  settle, and deletes the simulators afterwards.
- **One take.** The iPhone that rises out of the dark is the same object
  throughout: it docks into the Stage, joins the wall, takes commands, and
  hands the frame to the wordmark. `src/film/cues.ts` is the edit, in beats.
- **A pure function of time.** Every value on screen is computed from the
  playhead (`src/lib/time.ts`), so any frame renders the same on every run.
  `src/env.ts` freezes the clocks the borrowed Stage components keep.
- **Motion with weight.** Moves are springs that blend from where the last one
  is; thrown devices overshoot and settle, fast ones carry motion blur.
- **Its own score.** `src/score/score.ts` synthesizes the music and every
  sound effect in an `OfflineAudioContext` from the same cues as the picture,
  96 BPM in D major, so a tap, a keystroke or a landing sounds on its frame.

| Path                    | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `src/film/film.tsx`     | The film: rooms, appearance sweeps, camera, grain, the hero device |
| `src/film/acts/*.tsx`   | The acts, from first light to the wordmark                         |
| `src/film/cues.ts`      | Every cue, and the commands typed in act V                         |
| `src/film/layout.ts`    | Where the hero device is at any time, and the wall's layout        |
| `src/score/score.ts`    | The score and its sound effects                                    |
| `assets/`               | The captured screens, AX tree and device artwork                   |
| `scripts/capture.ts`    | Re-captures `assets/` from simulators                              |
| `build.ts`              | Builds `dist/promo.html` and serves it                             |
| `render.ts`             | Captures every frame, then encodes the outputs with ffmpeg         |
