import { expect, test } from "bun:test";
import { nativeTouchPoint } from "../client/utils/native-touch";

test("a finger dragged off the screen stays on its edge", () => {
  expect(nativeTouchPoint({ x: 1.08, y: -0.2 })).toEqual({ x: 1, y: 0 });
  expect(nativeTouchPoint({ x: -3, y: 4 })).toEqual({ x: 0, y: 1 });
});

test("a finger on the screen is left alone", () => {
  expect(nativeTouchPoint({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
  expect(nativeTouchPoint({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
});
