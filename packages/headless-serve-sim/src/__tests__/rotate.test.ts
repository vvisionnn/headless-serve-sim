import { expect, test } from "bun:test";
import { rotateLeft } from "../client/utils/rotate";

test("rotate left turns the device counter-clockwise, like Simulator.app", () => {
  // landscape_right is the device's top turned to the left (home on the right).
  expect(rotateLeft("portrait")).toBe("landscape_right");
});

test("rotate left cycles through all four orientations back to portrait", () => {
  const seen = ["portrait" as const];
  let o = rotateLeft("portrait");
  while (o !== "portrait") {
    seen.push(o as never);
    o = rotateLeft(o);
  }
  expect(seen).toEqual([
    "portrait",
    "landscape_right",
    "portrait_upside_down",
    "landscape_left",
  ] as never);
});
