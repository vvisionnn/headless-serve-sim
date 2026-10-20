/**
 * The edit, in seconds, on the score's grid: 120 BPM, so a beat is half a
 * second and a bar is two; the film is thirty bars. Every cut lands on a
 * beat, and the big ones on a downbeat.
 *
 * One continuous take: the iPhone that slams in out of the dark is the same
 * object that docks into the Stage, records itself, joins the wall, takes
 * commands, and hands the frame to the wordmark.
 */
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
const b = (beats: number) => beats * BEAT;

export const cue = {
  // I · cold open (bars 1–2): three words, then the device
  word1: b(2),
  word2: b(3),
  word3: b(4),
  flare: b(6),
  slam: b(8),
  // II · the device, without a window (bars 3–5)
  window: b(10),
  shatter: b(12),
  unlock: b(13),
  glide: b(13.5),
  noWindow: b(14),
  noWindowOut: b(19.25),
  // III · the Stage (bars 6–9)
  stage: b(20),
  toolbar: b(20.5),
  navigator: b(21),
  inspector: b(21.5),
  dock: b(22),
  cursor: b(23),
  appearance: b(24.5),
  palette: b(26),
  paletteRun: b(27.75),
  sweep: b(28),
  record: b(30),
  captureTab: b(30.5),
  tapSettings: b(31.5),
  home: b(33),
  stop: b(34),
  saved: b(34.25),
  screenshot: b(35),
  // IV · the console (bars 10–11)
  console: b(36),
  axTab: b(39),
  stageOut: b(43),
  // V · the wall (bars 12–16)
  wall: b(44),
  wallLine: b(45),
  hinge: b(50),
  wallOut: b(62),
  // VI · commands (bars 17–23)
  back: b(64),
  terminal: b(64.5),
  tap: b(66),
  ax: b(70),
  shot: b(75.5),
  loop: b(81),
  terminalOut: b(91.5),
  // VII · pocket (bars 23–25)
  qr: b(92),
  qrOut: b(99.5),
  // VIII · wordmark (bars 26–30)
  mark: b(100),
  install: b(105),
  fade: b(116.5),
  end: b(120),
} as const;

/** Commands typed in act VI (and the one the wall types), and when each one starts typing. */
export const commands = {
  hinge: { text: "headless-serve-sim motion angle 180 -d $DUO", at: cue.hinge - 1.45 },
  tap: { text: "headless-serve-sim tap 0.86 0.48 -d $UDID", at: cue.tap },
  ax: {
    text: `curl -s $HELPER/ax | jq -r '.. | select(.type? == "Button") | .AXLabel'`,
    at: cue.ax,
  },
  shot: { text: "headless-serve-sim screenshot settings.png -d $UDID", at: cue.shot },
  loop: {
    text: "for d in $(headless-serve-sim --list | jq -r '.streams[].device'); do",
    at: cue.loop,
  },
  loopBody: {
    text: `  headless-serve-sim screenshot "$d.png" -d "$d"; done`,
    at: cue.loop + 1.75,
  },
};

/**
 * A fast typist's cadence, not a metronome's: each key lands after a seeded,
 * slightly uneven gap, with longer pauses after spaces and punctuation.
 */
export function keyTimes(text: string, at: number) {
  let seed = 7;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const times: number[] = [];
  let t = at;
  for (const ch of text) {
    t += 0.009 + rand() * 0.016 + (ch === " " ? 0.024 : /[|'$-]/.test(ch) ? 0.01 : 0);
    times.push(t);
  }
  return times;
}

/** When a command finishes typing and Return lands. */
export function land(c: { text: string; at: number }) {
  return keyTimes(c.text, c.at).at(-1)! + 0.16;
}
