import { clamp, curve, ease, FPS, mix, spring } from "../lib/time";
import { BEAT, commands, cue, land } from "./cues";
import { size, type Body, type Pose } from "./device";

export interface Place {
  x: number;
  y: number;
  s: number;
}

/**
 * Additive keyframes: each move springs the delta from the previous target,
 * so a move that starts before the last one settles blends into it instead
 * of cutting it off — Apple's additive animation, done by hand.
 */
function track(
  t: number,
  start: Place,
  moves: { at: number; to: Place; dur: number; bounce?: number }[],
): Place {
  const out = { ...start };
  let prev = start;
  for (const m of moves) {
    const p = spring(t, m.at, m.dur, m.bounce ?? 0);
    out.x += (m.to.x - prev.x) * p;
    out.y += (m.to.y - prev.y) * p;
    out.s += (m.to.s - prev.s) * p;
    prev = m.to;
  }
  return out;
}

/** Pose plus velocity, measured across one frame, for motion blur. */
export function withVelocity(t: number, at: (t: number) => Pose): Pose {
  const now = at(t);
  const before = at(t - 1 / FPS);
  return { ...now, vx: now.x - before.x, vy: now.y - before.y };
}

/* Act III's stage: the room left between the Navigator and the Inspector. */
export const NAV_W = 264;
export const INS_W = 328;
export const GAP = 10;
export const MAIN = { left: NAV_W + GAP * 2, right: 1440 - INS_W - GAP * 2 };
export const STAGE_FIT: Place = { x: (MAIN.left + MAIN.right) / 2, y: 389, s: 0.228 };

/* Act IV: with the console open, the device re-fits into the room above it. */
export const CONSOLE_H = 300;
export const CONSOLE_FIT: Place = { x: (MAIN.left + MAIN.right) / 2, y: 238, s: 0.132 };

/* Act V's wall: every family on one floor line, sized by family. */
export const FLOOR = 600;
/** Thrown wall devices: a spring with some give, so they land, rise a hair, and settle. */
export const WALL_DUR = 0.7;
export const WALL_BOUNCE = 0.26;
const WALL_SPEC: {
  id: string;
  name: string;
  runtime: string;
  body: Body;
  height: number;
  at: number;
}[] = [
  { id: "ipad", name: "iPad Pro 13-inch (M5)", runtime: "iPadOS 27", body: { kind: "ipad" }, height: 330, at: cue.wall + BEAT * 2 },
  { id: "air", name: "iPhone Air", runtime: "iOS 27", body: { kind: "air" }, height: 284, at: cue.wall + BEAT },
  { id: "duo", name: "iPhone Duo", runtime: "iOS 27.1", body: { duo: 0 }, height: 262, at: cue.wall + BEAT * 3 },
  { id: "hero", name: "iPhone 17 Pro", runtime: "iOS 27", body: { kind: "iphone" }, height: 276, at: cue.stageOut + 0.25 },
  { id: "watch", name: "Apple Watch Ultra 3", runtime: "watchOS 27", body: { kind: "watch" }, height: 128, at: cue.wall + BEAT * 4 },
];

let wallCache: ReturnType<typeof layoutWall> | undefined;
function layoutWall() {
  const gap = 44;
  const items = WALL_SPEC.map((d) => {
    const unit = size(d.body, 1);
    const s = d.height / unit.h;
    return { ...d, s, w: unit.w * s };
  });
  let x = (1440 - items.reduce((a, d) => a + d.w, 0) - gap * (items.length - 1)) / 2;
  return items.map((d) => {
    const place = { x: x + d.w / 2, y: FLOOR - d.height / 2, s: d.s };
    x += d.w + gap;
    return { ...d, place };
  });
}
/** Computed once the captures have decoded, since the Duo's renders size it. */
export const wall = () => (wallCache ??= layoutWall());

export const COMMAND_PLACE: Place = { x: 1046, y: 408, s: 0.205 };

/** The hero iPhone at time t: where it is, how it is turned, how present it is. */
export function hero(t: number): Pose {
  const onWall = wall().find((d) => d.id === "hero")!;
  const p = track(t, { x: 720, y: 400, s: 0.205 }, [
    { at: cue.glide, to: { x: 470, y: 405, s: 0.2 }, dur: 0.75 },
    { at: cue.stage, to: STAGE_FIT, dur: 0.7 },
    { at: cue.console, to: CONSOLE_FIT, dur: 0.6 },
    { at: onWall.at, to: onWall.place, dur: WALL_DUR, bounce: WALL_BOUNCE },
    { at: cue.back, to: COMMAND_PLACE, dur: 0.8 },
  ]);
  // It comes out of the light at the viewer: from far too close, tipped and
  // turning, and lands with a hard little overshoot.
  const slam = spring(t, cue.slam, 0.55, 0.16);
  const leave = ease(t, cue.terminalOut, 0.4, curve.in);
  // A physical lean into each big move, in the direction of travel.
  const lean = (at: number, dir: number, dur = 0.6) =>
    dir * Math.sin(Math.PI * clamp((t - at) / dur)) * (t > at ? 1 : 0);
  return {
    ...p,
    y: p.y - leave * 30,
    s: p.s * mix(2.7, 1, slam) * (1 - leave * 0.08),
    opacity: ease(t, cue.slam - 0.04, 0.1) * (1 - leave),
    blur: mix(26, 0, clamp(slam)) + leave * 12,
    tiltX: mix(-26, 0, slam) + lean(onWall.at, 10, 0.8),
    tiltY: mix(34, 0, slam) + lean(cue.glide, 12) + lean(cue.stage, -10) + lean(cue.back, -12, 0.7),
    roll: mix(8, 0, slam),
  };
}

export const HINGE_DUR = 1.35;
/** The Duo's hinge: closed until its command lands, then opened to flat. */
export function duoAngle(t: number) {
  return 180 * ease(t, land(commands.hinge), HINGE_DUR, curve.hinge);
}
