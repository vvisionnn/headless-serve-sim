import { expect, test } from "bun:test";
import { glowColors } from "../client/shell/stage-effects";

test("glow colours come out clockwise from the top-left quadrant", () => {
  // Canvas order: TL, TR, BL, BR.
  const px = [200, 0, 0, 255, 0, 200, 0, 255, 0, 0, 200, 255, 200, 200, 0, 255];
  expect(glowColors(px)).toEqual([
    "rgb(200, 0, 0)",
    "rgb(0, 200, 0)",
    "rgb(200, 200, 0)",
    "rgb(0, 0, 200)",
  ]);
});

test("near-black samples are lifted so a dark screen still glows", () => {
  const black = new Array(16).fill(0);
  expect(glowColors(black)[0]).toBe("rgb(48, 48, 48)");
});
