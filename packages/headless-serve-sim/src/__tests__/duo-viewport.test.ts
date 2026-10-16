import { expect, test } from "bun:test";
import { duoOutputSide, duoViewport } from "../client/utils/duo-viewport";

test("keeps one display scale when folding crosses a square silhouette", () => {
  const wide = duoViewport([0.075, 0.075, 0.85, 0.84], 3420, 3420, 1400, 800);
  const tall = duoViewport([0.075, 0.075, 0.84, 0.85], 3420, 3420, 1400, 800);
  expect(wide.width / wide.crop.width).toBeCloseTo(tall.width / tall.crop.width, 6);
  const edge = duoViewport([0.45, 0.075, 0.1, 0.85], 3420, 3420, 1400, 800);
  expect(edge.width / edge.crop.width).toBeCloseTo(wide.width / wide.crop.width, 6);
  expect(edge.height).toBeLessThan(621);
});

test("caps initial Duo size without reducing its native pixels", () => {
  const view = duoViewport([0.08, 0.2, 0.84, 0.6], 3420, 3420, 1400, 800);
  expect(view.width).toBeCloseTo((2874 * 620) / (3420 * 0.85));
  expect(view.crop).toEqual({ x: 273, y: 684, width: 2874, height: 2052 });
  const larger = duoViewport([0.08, 0.2, 0.84, 0.6], 3420, 3420, 1400, 800, 1.5);
  expect(larger.width).toBeCloseTo((2874 * 800) / (3420 * 0.85));
  expect(larger.crop).toEqual(view.crop);
});

test("fits the full native device without shrinking it for transparent stream padding", () => {
  const view = duoViewport([0.08, 0.2, 0.84, 0.6], 3420, 3420, 1000, 450);
  expect(view.crop).toEqual({ x: 273, y: 684, width: 2874, height: 2052 });
  expect(view.width / view.height).toBeCloseTo(2874 / 2052);
  expect(view.width).toBeCloseTo((2874 * 450) / (3420 * 0.85));
  expect(view.height).toBeLessThan(450);
  const smaller = duoViewport([0.08, 0.2, 0.84, 0.6], 3420, 3420, 1000, 450, 0.5);
  expect(smaller.width).toBeCloseTo(view.width / 2);
  expect(smaller.height).toBeCloseTo(view.height / 2);
});

test("requests the output side the viewer actually displays", () => {
  // The device envelope is 85% of the square output; 620 CSS px is the default cap.
  expect(duoOutputSide(1400, 800, 1, 2)).toBe(Math.ceil((620 * 2) / 0.85));
  expect(duoOutputSide(1400, 800, 1, 1)).toBe(Math.ceil(620 / 0.85));
  // Zoom grows the request until the device fills the shorter side.
  expect(duoOutputSide(1400, 800, 1.5, 2)).toBe(Math.ceil((800 * 2) / 0.85));
  expect(duoOutputSide(1400, 800, 9, 2)).toBe(Math.ceil((800 * 2) / 0.85));
});
