import { expect, test } from "bun:test";
import { rotationStart } from "../client/utils/stage-pose";

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
});
