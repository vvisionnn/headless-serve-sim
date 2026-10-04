import { expect, test } from "bun:test";
import { projectedPoint, rawPointForProjection } from "../composition-mapping";
import {
  duoProjectedPoint,
  duoRawPointForProjection,
} from "../../../headless-serve-sim/src/client/duo-model";

test("app and public viewer share the same pure projection implementation", () => {
  expect(duoProjectedPoint).toBe(projectedPoint);
  expect(duoRawPointForProjection).toBe(rawPointForProjection);
});

test("shared projection retains perspective and inverse tolerance across panel regions", () => {
  for (const quad of [
    [
      [0.1, 0.2],
      [0.9, 0.2],
      [0.9, 0.8],
      [0.1, 0.8],
    ],
    [
      [0, 0],
      [1, 0],
      [0.75, 1],
      [0.25, 1],
    ],
    [
      [0.2, 0.1],
      [0.7, 0.3],
      [0.8, 0.9],
      [0.1, 0.8],
    ],
  ]) {
    const piece = { quad, region: [0, 0.5, 1, 0.5] };
    for (const [x, y] of [
      [0, 0.5],
      [1, 1],
      [0.5, 0.75],
      [0.2, 0.6],
    ]) {
      const raw = { x: x!, y: y! };
      const projected = projectedPoint(raw, piece)!;
      const inverse = rawPointForProjection(projected, piece)!;
      expect(inverse.x).toBeCloseTo(raw.x, 10);
      expect(inverse.y).toBeCloseTo(raw.y, 10);
    }
    expect(projectedPoint({ x: 0.5, y: 0.1 }, piece)).toBeNull();
    expect(rawPointForProjection({ x: -1, y: -1 }, piece)).toBeNull();
  }
  expect(
    projectedPoint(
      { x: 0.5, y: 0.75 },
      {
        quad: [
          [0, 0],
          [1, 0],
          [0.75, 1],
          [0.25, 1],
        ],
        region: [0, 0.5, 1, 0.5],
      },
    )?.y,
  ).toBeCloseTo(2 / 3);
  expect(rawPointForProjection({ x: 0.5, y: 0.5 }, { quad: [], region: [0, 0, 1, 1] })).toBeNull();
});
