import { expect, test } from "bun:test";
import { duoAxPolygons } from "../client/duo-model";

test("AX rectangles rotate into raw pixels and split at the inner hinge", () => {
  const pieces = [
    {
      displayId: 3,
      quad: [
        [0.5, 0],
        [0.5, 1],
        [0, 1],
        [0, 0],
      ],
      region: [0, 0.5, 1, 0.5],
    },
    {
      displayId: 3,
      quad: [
        [1, 0],
        [1, 1],
        [0.5, 1],
        [0.5, 0],
      ],
      region: [0, 0, 1, 0.5],
    },
  ];
  const frame = { x: 400, y: 80, width: 200, height: 100 };
  const polygons = duoAxPolygons(frame, {
    displayId: 3,
    rawWidth: 2007,
    rawHeight: 2853,
    rawRotation: 90,
    pieces,
  });
  expect(polygons).toHaveLength(2);
  expect(polygons[0]![0]!.x).toBeCloseTo(400 / 951);
  expect(polygons[0]![0]!.y).toBeCloseTo(80 / 669);
  expect(polygons[0]![1]!.x).toBeCloseTo(0.5);
  expect(polygons[1]![1]!.x).toBeCloseTo(600 / 951);
  expect(polygons[1]![2]!.y).toBeCloseTo(180 / 669);
});
