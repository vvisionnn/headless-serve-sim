import { clamp, curve, ease, FPS, mix, spring } from "../lib/time";
import type { Screen } from "./assets";
import { WALL_BOUNCE, WALL_DUR } from "./beats";
import { cue } from "./cues";
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

/* Act IV's wall: every family on one floor line, sized by family. */
export const FLOOR = 598;
const WALL_SPEC: { id: string; name: string; runtime: string; body: Body; height: number }[] = [
  {
    id: "ipad",
    name: "iPad Pro 13-inch (M5)",
    runtime: "iPadOS 27",
    body: { kind: "ipad" },
    height: 396,
  },
  { id: "air", name: "iPhone Air", runtime: "iOS 27", body: { kind: "air" }, height: 318 },
  { id: "duo", name: "iPhone Duo", runtime: "iOS 27.1", body: { duo: "duoBook" }, height: 336 },
  { id: "hero", name: "iPhone 17 Pro", runtime: "iOS 27", body: { kind: "iphone" }, height: 304 },
  {
    id: "watch",
    name: "Apple Watch Ultra 3",
    runtime: "watchOS 27",
    body: { kind: "watch" },
    height: 146,
  },
];

let wallCache: ReturnType<typeof layoutWall> | undefined;
function layoutWall() {
  const gap = 52;
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
  const onWall = wall().find((d) => d.id === "hero")!.place;
  const p = track(t, { x: 720, y: 405, s: 0.205 }, [
    { at: cue.glide, to: { x: 470, y: 405, s: 0.2 }, dur: 1.4 },
    { at: cue.stage, to: STAGE_FIT, dur: 1.2 },
    { at: cue.wall, to: onWall, dur: WALL_DUR, bounce: WALL_BOUNCE },
    { at: cue.wallOut + 0.12, to: COMMAND_PLACE, dur: 1.3 },
  ]);
  // It arrives out of the dark the way a real object would: from below, tipped
  // toward you, turning as it comes, and settling with a breath of overshoot.
  const rise = spring(t, cue.rise, 2.1, 0.08);
  const leave = ease(t, cue.terminalOut, 0.7, curve.in);
  // A small physical lean into each big move, in the direction of travel.
  const lean = (at: number, dir: number) =>
    dir * Math.sin(Math.PI * clamp((t - at) / 0.9)) * (t > at ? 1 : 0);
  return {
    ...p,
    y: p.y + mix(90, 0, rise) - leave * 24,
    s: p.s * (1 - leave * 0.06),
    opacity: ease(t, cue.rise, 0.8) * (1 - leave),
    blur: mix(18, 0, clamp(spring(t, cue.rise, 1.4))) + leave * 10,
    tiltX: mix(28, 0, rise),
    tiltY: mix(-22, 0, rise) + lean(cue.glide, 9) + lean(cue.wallOut + 0.12, -9),
    roll: mix(-5, 0, rise),
  };
}

/** The Duo on the wall: thrown in closed, then opened like a book. */
export function duoScreen(t: number): { from: Screen; to: Screen; p: number } {
  const p = clamp(spring(t, cue.unfold, 0.9));
  return { from: "duoClosed", to: "duoBook", p };
}
