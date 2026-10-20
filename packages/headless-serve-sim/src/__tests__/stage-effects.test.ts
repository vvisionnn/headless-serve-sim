import { expect, test } from "bun:test";
import { fittedRegion, glowColors, screenCaptureAngle } from "../client/shell/stage-effects";

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

test("a stream turned with CSS is captured as it looks, not as it decodes", () => {
  // A portrait frame drawn sideways: the 100×200 image fills a 200×100 screen.
  expect(screenCaptureAngle("matrix(0, -1, 1, 0, 0, 0)")).toBeCloseTo(-90);
  expect(screenCaptureAngle("matrix(-1, 0, 0, -1, 0, 0)")).toBeCloseTo(180);
  expect(screenCaptureAngle("none")).toBe(0);
});

test("a contained picture is captured as drawn, not stretched to its box", () => {
  // A 200×100 composite letterboxed into a 100×100 tile.
  expect(fittedRegion("contain", 100, 100, 200, 100)).toEqual({
    source: { x: 0, y: 0, width: 200, height: 100 },
    box: { x: 0, y: 25, width: 100, height: 50 },
  });
});

test("a covering picture is captured by the part it shows", () => {
  // A 100×200 frame cropped into a 100×100 tile.
  expect(fittedRegion("cover", 100, 100, 100, 200)).toEqual({
    source: { x: 0, y: 50, width: 100, height: 100 },
    box: { x: 0, y: 0, width: 100, height: 100 },
  });
});

test("a filled picture is captured whole", () => {
  expect(fittedRegion("fill", 50, 100, 1000, 1000)).toEqual({
    source: { x: 0, y: 0, width: 1000, height: 1000 },
    box: { x: 0, y: 0, width: 50, height: 100 },
  });
});
