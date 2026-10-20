import { expect, test } from "bun:test";
import {
  AT_REST,
  rotationStart,
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
