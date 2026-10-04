import { expect, test } from "bun:test";
import { duoWheelDelta, duoUvForRawPoint, duoTouchCoordinates } from "../client/duo-model";

test("maps screen wheel displacement back to the raw integrated display", () => {
  const vertical = duoWheelDelta({ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.2 }, 2007, 2853);
  expect(vertical.dx).toBe(0);
  expect(vertical.dy).toBeCloseTo(285.3);
  const horizontal = duoWheelDelta({ x: 0.2, y: 0.3 }, { x: 0.1, y: 0.3 }, 2007, 2853);
  expect(horizontal.dx).toBeCloseTo(200.7);
  expect(horizontal.dy).toBe(0);
});

test("downward screen wheel maps to positive raw X on the unfolded clockwise panel", () => {
  const from = duoTouchCoordinates({ x: 0.6, y: 0.5 }, 90);
  const to = duoTouchCoordinates({ x: 0.6, y: 0.4 }, 90);
  const delta = duoWheelDelta(from, to, 2007, 2853);
  expect(-delta.dx).toBeCloseTo(200.7);
  expect(-delta.dy).toBeCloseTo(0);
});

test("maps native points to model texture UV without changing screen orientation", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const raw = { x: 0.2, y: 0.7 };
    const uv = duoUvForRawPoint(raw, rotation);
    expect(uv.x).toBeGreaterThanOrEqual(0);
    expect(uv.y).toBeGreaterThanOrEqual(0);
    const result = duoTouchCoordinates(uv, rotation);
    expect(result.x).toBeCloseTo(raw.x);
    expect(result.y).toBeCloseTo(raw.y);
  }
});
