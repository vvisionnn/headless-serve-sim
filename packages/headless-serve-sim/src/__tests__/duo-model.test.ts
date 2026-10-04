import { expect, test } from "bun:test";
import { duoTouchCoordinates } from "../client/duo-model";

test("maps screen raycast UV to stream coordinates", () => {
  expect(duoTouchCoordinates({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.25 });
  expect(duoTouchCoordinates({ x: -0.2, y: 1.2 })).toEqual({ x: 0, y: 0 });
  expect(duoTouchCoordinates({ x: 0.25, y: 0.75 }, 90)).toEqual({ x: 0.25, y: 0.75 });
  expect(duoTouchCoordinates({ x: 0.25, y: 0.75 }, -90)).toEqual({ x: 0.75, y: 0.25 });
});
