/**
 * The edit, in seconds, on the score's grid: 96 BPM, so a beat is 0.625 s and
 * a bar is 2.5 s; the film is sixteen bars. Every transition lands on a beat,
 * and the big ones on a downbeat.
 *
 * One continuous take: the iPhone that wakes in the dark is the same object
 * that docks into the Stage, joins the wall, takes commands, and hands the
 * frame to the wordmark.
 */
export const BPM = 96;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
const b = (beats: number) => beats * BEAT;

export const cue = {
  // I · first light (bars 1–2)
  glow: 0,
  rise: b(1),
  screenOn: b(3),
  name: b(5),
  // II · no window (bars 3–4)
  window: b(6),
  windowGone: b(7.5),
  glide: b(8),
  unlock: b(8.5),
  noWindow: b(9),
  noWindowOut: b(13.5),
  // III · the stage (bars 4–6)
  stage: b(14),
  toolbar: b(14.25),
  navigator: b(14.5),
  inspector: b(14.75),
  dock: b(15.25),
  cursor: b(16.5),
  click: b(18),
  palette: b(20),
  paletteRun: b(21.75),
  light: b(22),
  stageOut: b(24.5),
  // IV · the wall (bars 7–8)
  wall: b(25),
  wallLine: b(26),
  unfold: b(27),
  wallOut: b(32),
  // V · commands (bars 9–12)
  dark: b(33),
  terminal: b(33.25),
  commandLine: b(33.5),
  tap: b(35),
  ax: b(38),
  shot: b(43),
  terminalOut: b(47.6),
  // VI · pocket (bar 13)
  qr: b(48),
  qrOut: b(51.75),
  // VII · wordmark (bars 14–16)
  mark: b(52),
  install: b(56),
  fade: b(62.4),
  end: b(64),
} as const;

/** Commands typed in act V, and when each one starts typing. */
export const commands = {
  tap: { text: "headless-serve-sim tap 0.86 0.48 -d $UDID", at: cue.tap },
  ax: {
    text: `curl -s $HELPER/ax | jq -r '.. | select(.type? == "Button") | .AXLabel'`,
    at: cue.ax,
  },
  shot: { text: "headless-serve-sim screenshot settings.png -d $UDID", at: cue.shot },
};

/**
 * A typist's cadence, not a metronome's: each key lands after a seeded,
 * slightly uneven gap, with longer pauses after spaces and punctuation.
 */
export function keyTimes(text: string, at: number) {
  let seed = 7;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const times: number[] = [];
  let t = at;
  for (const ch of text) {
    t += 0.012 + rand() * 0.022 + (ch === " " ? 0.03 : /[|'$-]/.test(ch) ? 0.015 : 0);
    times.push(t);
  }
  return times;
}

/** When a command finishes typing and Return lands. */
export function land(c: { text: string; at: number }) {
  return keyTimes(c.text, c.at).at(-1)! + 0.22;
}
