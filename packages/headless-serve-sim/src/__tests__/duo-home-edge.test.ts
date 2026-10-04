import { expect, test } from "bun:test";
import { duoHomeEdge } from "../client/duo-model";

test("Home swipes use the raw native bottom edge for every panel orientation", () => {
  for (const [rotation, point, edge] of [
    [0, { x: 0.5, y: 0.97 }, 3],
    [90, { x: 0.97, y: 0.5 }, 4],
    [180, { x: 0.5, y: 0.03 }, 1],
    [270, { x: 0.03, y: 0.5 }, 2],
  ] as const) {
    expect(duoHomeEdge(point, rotation)).toBe(edge);
    expect(duoHomeEdge({ x: 0.5, y: 0.5 }, rotation)).toBeUndefined();
  }
});
