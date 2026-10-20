/**
 * Moments that both the picture and the score need: when a key lands, when a
 * thrown device touches the floor, when an accessibility frame appears. One
 * definition, so a sound can never miss its frame.
 */
import { curve, ease, spring } from "../lib/time";
import { axNodes } from "./assets";
import { commands, cue, keyTimes, land } from "./cues";

export const INSTALL = "mise use -g github:vvisionnn/headless-serve-sim";
export const PALETTE_QUERY = "theme";

export const PALETTE_KEYS = keyTimes(PALETTE_QUERY, cue.palette + 0.3).map((t, i) => t + i * 0.05);
export const INSTALL_KEYS = keyTimes(INSTALL, cue.install);

/** How far the accessibility overlay has come in, 0 → 1. */
export const axProgress = (t: number) => ease(t, land(commands.ax), 1.1, curve.fluid);
/** Frame i shows once the overlay passes its threshold. */
export const axThreshold = (i: number) => (i * 0.045) / 1.7;

function firstTime(test: (t: number) => boolean, from: number, to: number) {
  for (let t = from; t < to; t += 0.001) if (test(t)) return t;
  return to;
}

export const AX_TIMES = axNodes.map((_, i) =>
  firstTime((t) => axProgress(t) > axThreshold(i), land(commands.ax), land(commands.ax) + 2),
);

/** Thrown wall devices: a spring with a little bounce, so they land, rise a hair, and settle. */
export const WALL_DUR = 0.95;
export const WALL_BOUNCE = 0.22;
export const wallThrowAt = (i: number) => cue.wall + [0.16, 0.08, 0, 0, 0.24][i]!;
export const WALL_LANDINGS = [0, 1, 2, 3, 4].map((i) => ({
  i,
  t: firstTime(
    (t) => spring(t, wallThrowAt(i), WALL_DUR, WALL_BOUNCE) >= 1,
    wallThrowAt(i),
    wallThrowAt(i) + 2,
  ),
}));
