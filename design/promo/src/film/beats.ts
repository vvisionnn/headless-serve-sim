/**
 * Moments that both the picture and the score need: when a key lands, when a
 * thrown device touches the floor, when an accessibility frame appears. One
 * definition, so a sound can never miss its frame.
 */
import { curve, ease, spring } from "../lib/time";
import { axNodes } from "./assets";
import { commands, cue, keyTimes, land } from "./cues";
import { wall, WALL_BOUNCE, WALL_DUR } from "./layout";

export const INSTALL = "mise use -g github:vvisionnn/headless-serve-sim";
export const PALETTE_QUERY = "theme";

export const PALETTE_KEYS = keyTimes(PALETTE_QUERY, cue.palette + 0.25).map((t, i) => t + i * 0.035);
export const INSTALL_KEYS = keyTimes(INSTALL, cue.install);

/** How far the accessibility overlay has come in, 0 → 1. */
export const axProgress = (t: number) => ease(t, land(commands.ax), 0.8, curve.fluid);
/** Frame i shows once the overlay passes its threshold. */
export const axThreshold = (i: number) => (i * 0.045) / 1.7;

function firstTime(test: (t: number) => boolean, from: number, to: number) {
  for (let t = from; t < to; t += 0.001) if (test(t)) return t;
  return to;
}

export const AX_TIMES = axNodes.map((_, i) =>
  firstTime((t) => axProgress(t) > axThreshold(i), land(commands.ax), land(commands.ax) + 2),
);

/** When each wall device first touches the floor, in wall order. */
export const wallLandings = () =>
  wall().map((d) => ({
    id: d.id,
    t: firstTime((t) => spring(t, d.at, WALL_DUR, WALL_BOUNCE) >= 1, d.at, d.at + 2),
  }));
