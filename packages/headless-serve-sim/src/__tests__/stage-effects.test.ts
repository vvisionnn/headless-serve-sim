import { expect, test } from "bun:test";
import {
  fittedRegion,
  glowColors,
  screenCaptureAngle,
  screenGlowFrame,
} from "../client/shell/stage-effects";
import { rotationStart } from "../client/utils/stage-pose";

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

test("the glow is drawn in the device's own frame, so a turn carries it unchanged", () => {
  const portrait = { rotation: 0, cx: 500, cy: 450, width: 400, height: 800 };
  // Landscape fits the stage at a different size than portrait.
  const landscape = { rotation: 90, cx: 500, cy: 350, width: 900, height: 450 };
  const before = screenGlowFrame(portrait);
  const after = screenGlowFrame(landscape);
  const start = rotationStart(portrait, landscape);
  // The turn's start transform maps the new glow exactly onto the old one.
  expect(after.width * start.scale).toBeCloseTo(before.width);
  expect(after.height * start.scale).toBeCloseTo(before.height);
  expect(after.blur * start.scale).toBeCloseTo(before.blur);
  expect((after.rotate + start.rotate) % 360).toBe(before.rotate);
  // At rest it lies along the device: across a landscape screen, turned with it.
  expect(after).toMatchObject({ width: 450, height: 900, rotate: 90 });
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
