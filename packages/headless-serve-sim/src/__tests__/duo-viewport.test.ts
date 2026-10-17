import { expect, test } from "bun:test";
import { duoOutputSide, duoViewport } from "../client/utils/duo-viewport";

// Silhouettes measured from a live iPhone Duo composite (portrait).
const FOLDED = [0.28, 0.2, 0.44, 0.61];
const OPEN = [0.1, 0.19, 0.8, 0.62];

test("keeps one display scale across fold poses", () => {
  const folded = duoViewport(FOLDED, 3420, 3420, 1400, 800);
  const open = duoViewport(OPEN, 3420, 3420, 1400, 800);
  expect(folded.width / folded.crop.width).toBeCloseTo(open.width / open.crop.width, 6);
  expect(folded.crop).toEqual({ x: 957, y: 684, width: 1506, height: 2087 });
});

test("fills the stage height like a phone instead of a fixed cap", () => {
  const folded = duoViewport(FOLDED, 3420, 3420, 1400, 800);
  expect(folded.height).toBeGreaterThan(760);
  expect(folded.height).toBeLessThanOrEqual(800);
  const open = duoViewport(OPEN, 3420, 3420, 1400, 800);
  expect(open.width).toBeLessThanOrEqual(1400);
  expect(open.height).toBeLessThanOrEqual(800);
});

test("fits the open device's width on a narrow stage", () => {
  const open = duoViewport(OPEN, 3420, 3420, 700, 900);
  expect(open.width).toBeLessThanOrEqual(700);
  expect(open.width).toBeGreaterThan(660);
});

test("swaps the extent when the device is turned to landscape", () => {
  const turned = [0.19, 0.1, 0.62, 0.8];
  const view = duoViewport(turned, 3420, 3420, 1400, 800, 1, true);
  expect(view.height).toBeLessThanOrEqual(800);
  expect(view.height).toBeGreaterThan(760);
});

test("scale shrinks the device but never past the fit", () => {
  const fit = duoViewport(FOLDED, 3420, 3420, 1400, 800);
  const half = duoViewport(FOLDED, 3420, 3420, 1400, 800, 0.5);
  expect(half.width).toBeCloseTo(fit.width / 2);
  expect(half.crop).toEqual(fit.crop);
  const big = duoViewport(FOLDED, 3420, 3420, 1400, 800, 3);
  expect(big.height).toBeCloseTo(fit.height);
});

test("requests the output side the viewer actually displays", () => {
  const side = Math.min(1400 / 0.82, 800 / 0.63);
  expect(duoOutputSide(1400, 800, 1, 2)).toBe(Math.ceil(side * 2));
  expect(duoOutputSide(1400, 800, 1, 1)).toBe(Math.ceil(side));
  expect(duoOutputSide(1400, 800, 0.5, 2)).toBe(Math.ceil(side));
  expect(duoOutputSide(1400, 800, 9, 2)).toBe(Math.ceil(side * 2));
  expect(duoOutputSide(800, 1400, 1, 1, true)).toBe(Math.ceil(side));
});
