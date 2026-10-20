import { expect, test } from "bun:test";
import { spring as springGenerator } from "motion";
import {
  AT_REST,
  resizeStart,
  rotationStart,
  turnTransition,
  unturnedSize,
  type StagePose,
  type TurnOffsets,
} from "../client/utils/stage-pose";

const portrait = { rotation: 0, cx: 500, cy: 450, width: 400, height: 800 };
const landscape = { rotation: 90, cx: 500, cy: 350, width: 800, height: 400 };

test("a quarter turn starts drawn at the old angle and the old size", () => {
  const start = rotationStart(portrait, landscape);
  // The new landscape box, turned back a quarter, looks like the old portrait.
  expect(start.rotate).toBe(-90);
  expect(start.scale).toBeCloseTo(400 / 400);
  expect(start.x).toBe(0);
  expect(start.y).toBe(100);
  // The dock starts at the old bottom edge (850) instead of the new one (550).
  expect(start.lift).toBe(300);
  // The contact shadow starts as wide as the old device rests, not the new.
  expect(start.footprint).toBe(0.5);
});

test("turns the short way round, including through the 270/-90 seam", () => {
  expect(rotationStart({ ...portrait, rotation: -90 }, { ...portrait, rotation: 180 }).rotate).toBe(
    90,
  );
  expect(rotationStart({ ...portrait, rotation: 180 }, { ...portrait, rotation: -90 }).rotate).toBe(
    -90,
  );
  expect(rotationStart({ ...portrait, rotation: 0 }, { ...portrait, rotation: -90 }).rotate).toBe(
    90,
  );
});

test("a half turn keeps the size", () => {
  const start = rotationStart(portrait, { ...portrait, rotation: 180, width: 200, height: 400 });
  expect(Math.abs(start.rotate)).toBe(180);
  expect(start.scale).toBeCloseTo(2);
  expect(start.footprint).toBeCloseTo(2);
});

// Where a pose plus the turn's live offsets is drawn on the stage: the turning
// element spins about the visible centre, the dock and shadow hang off the
// bottom edge.
const drawn = (pose: StagePose, at: TurnOffsets) => ({
  cx: pose.cx + at.x,
  cy: pose.cy + at.y,
  rotation: (((pose.rotation + at.rotate) % 360) + 360) % 360,
  width: unturnedSize(pose).width * at.scale,
  height: unturnedSize(pose).height * at.scale,
  dock: pose.cy + pose.height / 2 + at.lift,
  shadow: pose.width * at.footprint,
});

test("a second turn mid-turn starts from where the device is drawn", () => {
  const upsideDown = { rotation: 180, cx: 500, cy: 450, width: 400, height: 800 };
  // Partway through portrait → landscape: 40° still to go, a little small.
  const live = { rotate: -40, scale: 0.9, x: 3, y: 60, lift: 140, footprint: 0.7 };
  const start = rotationStart(landscape, upsideDown, live);
  const before = drawn(landscape, live);
  const after = drawn(upsideDown, start);
  for (const key of Object.keys(before) as (keyof typeof before)[])
    expect(after[key]).toBeCloseTo(before[key]);
  // Drawn at 50°, heading to 180°: 130° the short way, not 230° back round.
  expect(start.rotate).toBe(-130);
});

test("turning back mid-turn takes the short way to the old rest", () => {
  // Drawn at 330° (rest 180, 150° still to go) and sent back to portrait.
  const start = rotationStart({ ...portrait, rotation: 180 }, portrait, {
    ...AT_REST,
    rotate: 150,
  });
  expect(start.rotate).toBe(-30);
});

test("from rest a turn starts from the rest pose", () => {
  expect(rotationStart(portrait, landscape, AT_REST)).toEqual(rotationStart(portrait, landscape));
});

// Where a pose's screen is drawn under offsets that turn nothing: the turning
// element scales about the device box's centre.
const drawnScreen = (pose: StagePose, at: TurnOffsets) => {
  const screen = pose.screen ?? { cx: pose.cx, cy: pose.cy, width: pose.width };
  return {
    cx: pose.cx + at.scale * (screen.cx - pose.cx) + at.x,
    cy: pose.cy + at.scale * (screen.cy - pose.cy) + at.y,
    width: screen.width * at.scale,
  };
};

test("a resize starts with the new screen drawn over the old one", () => {
  // Bezel on: the screen sits a little off the body's centre (side buttons).
  const framed = {
    rotation: 0,
    cx: 600,
    cy: 420,
    width: 500,
    height: 800,
    screen: { cx: 604, cy: 420, width: 440 },
  };
  // Bezel off: the bare screen fills the box and is bigger.
  const bare = { rotation: 0, cx: 600, cy: 430, width: 520, height: 820 };
  const start = resizeStart(framed, bare);
  const before = drawnScreen(framed, AT_REST);
  const after = drawnScreen(bare, start);
  for (const key of Object.keys(before) as (keyof typeof before)[])
    expect(after[key]).toBeCloseTo(before[key]);
  expect(start.rotate).toBe(0);
  // The dock starts at the old bottom edge (820) instead of the new one (840).
  expect(start.lift).toBe(-20);
  expect(start.footprint).toBeCloseTo(500 / 520);
  // And back: the framed screen starts drawn over the bare one.
  const back = resizeStart(bare, framed);
  const from = drawnScreen(bare, AT_REST);
  const to = drawnScreen(framed, back);
  for (const key of Object.keys(from) as (keyof typeof from)[])
    expect(to[key]).toBeCloseTo(from[key]);
});

test("a resize begun mid-resize starts from where the screen is drawn", () => {
  const small = { rotation: 0, cx: 600, cy: 400, width: 300, height: 600 };
  const big = { rotation: 0, cx: 600, cy: 420, width: 450, height: 900 };
  const live = { ...AT_REST, scale: 0.8, x: 4, y: -10, lift: -30, footprint: 0.8 };
  const start = resizeStart(small, big, live);
  const before = drawnScreen(small, live);
  const after = drawnScreen(big, start);
  for (const key of Object.keys(before) as (keyof typeof before)[])
    expect(after[key]).toBeCloseTo(before[key]);
  expect(big.cy + big.height / 2 + start.lift).toBeCloseTo(small.cy + small.height / 2 + live.lift);
});

// Steps a transition the way Motion's frame loop would, 60 times a second.
function frames(transition: ReturnType<typeof turnTransition>, from: number) {
  const g = springGenerator({ keyframes: [from, 0], ...transition });
  const values: number[] = [];
  for (let i = 0; i < 600; i++) {
    const { value, done } = g.next(i * (1000 / 60));
    values.push(value as number);
    if (done) break;
  }
  return values;
}

test("a turn settles on its own instead of snapping to rest on its last frame", () => {
  for (const from of [-90, 180]) {
    const values = frames(turnTransition(from, null), from);
    expect(values.at(-1)).toBe(0);
    expect(Math.abs(values.at(-2)!)).toBeLessThan(0.01);
  }
  const moving = frames(turnTransition(-90, 1000), -90);
  expect(Math.abs(moving.at(-2)!)).toBeLessThan(0.01);
  // The scale channel too (offset from its rest of 1): no sub-pixel re-sharpen.
  const scale = frames(turnTransition(-90, null), 0.3);
  expect(Math.abs(scale.at(-2)!)).toBeLessThan(0.0001);
});

test("a half turn takes a little longer than a quarter", () => {
  expect(frames(turnTransition(180, null), 180).length).toBeGreaterThan(
    frames(turnTransition(90, null), 90).length,
  );
});

test("a turn picked up mid-turn starts its clock at the last frame drawn", () => {
  // Its start was read from that frame, so no time between it and the click is lost.
  expect(turnTransition(-60, 1234.5)).toMatchObject({ startTime: 1234.5 });
  expect(turnTransition(-90, null)).not.toHaveProperty("startTime");
});
