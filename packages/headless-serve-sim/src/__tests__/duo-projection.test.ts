import { expect, test } from "bun:test";
import { duoRawPointForProjection, duoProjectedPoint } from "../client/duo-model";

test("maps a projected native screen point to its raw panel region", () => {
  const piece = {
    displayId: 3,
    quad: [
      [0.1, 0.2],
      [0.9, 0.2],
      [0.9, 0.8],
      [0.1, 0.8],
    ],
    region: [0, 0.5, 1, 0.5],
  };
  expect(duoRawPointForProjection({ x: 0.5, y: 0.5 }, piece)).toEqual({ x: 0.5, y: 0.75 });
  expect(duoRawPointForProjection({ x: 0, y: 0 }, piece)).toBeNull();
});

test("forward projection follows perspective, not bilinear interpolation", () => {
  const piece = {
    quad: [
      [0, 0],
      [1, 0],
      [0.75, 1],
      [0.25, 1],
    ],
    region: [0, 0.5, 1, 0.5],
  };
  const raw = { x: 0.5, y: 0.75 };
  const projected = duoProjectedPoint(raw, piece);
  expect(projected?.x).toBeCloseTo(0.5);
  expect(projected?.y).toBeCloseTo(2 / 3);
  const inverse = duoRawPointForProjection(projected!, piece);
  expect(inverse?.x).toBeCloseTo(raw.x);
  expect(inverse?.y).toBeCloseTo(raw.y);
  expect(duoProjectedPoint({ x: 0.5, y: 0.1 }, piece)).toBeNull();
});
