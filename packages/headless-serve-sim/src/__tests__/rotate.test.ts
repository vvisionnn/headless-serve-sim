import { expect, test } from "bun:test";
import { rotateLeft } from "../client/utils/rotate";

test("rotate left cycles through all four orientations back to portrait", () => {
  const seen = ["portrait" as const];
  let o = rotateLeft("portrait");
  while (o !== "portrait") {
    seen.push(o as never);
    o = rotateLeft(o);
  }
  expect(seen).toEqual([
    "portrait",
    "landscape_left",
    "portrait_upside_down",
    "landscape_right",
  ] as never);
});
