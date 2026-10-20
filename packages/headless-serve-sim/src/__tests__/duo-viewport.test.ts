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

test("swaps the extent when the composite is turned a quarter", () => {
  const turned = [0.19, 0.1, 0.62, 0.8];
  const view = duoViewport(turned, 3420, 3420, 1400, 800, 1, 90);
  expect(view.height).toBeLessThanOrEqual(800);
  expect(view.height).toBeGreaterThan(760);
  for (const rotation of [-90, 270, 450])
    expect(duoViewport(turned, 3420, 3420, 1400, 800, 1, rotation)).toEqual(view);
  expect(duoViewport(FOLDED, 3420, 3420, 1400, 800, 1, 180).width).toBeCloseTo(
    duoViewport(FOLDED, 3420, 3420, 1400, 800).width,
    6,
  );
});

test("changes the display scale continuously through a turn", () => {
  const scaleAt = (rotation: number) => {
    const view = duoViewport(OPEN, 3420, 3420, 1400, 800, 1, rotation);
    return view.width / view.crop.width;
  };
  const portrait = scaleAt(0),
    landscape = scaleAt(90),
    half = scaleAt(45);
  expect(landscape).toBeLessThan(portrait);
  expect(half).toBeLessThan(portrait);
  expect(half).toBeGreaterThan(landscape);
  // No step anywhere: one degree of roll moves the scale by a small fraction of the full change.
  for (let rotation = 0; rotation < 90; rotation++)
    expect(Math.abs(scaleAt(rotation + 1) - scaleAt(rotation))).toBeLessThan(
      (portrait - landscape) / 30,
    );
  expect(scaleAt(0.01)).toBeCloseTo(portrait, 4);
  expect(scaleAt(89.99)).toBeCloseTo(landscape, 4);
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
});

test("requests one output side for either orientation so a turn never resizes the encoder", () => {
  const portrait = Math.min(700 / 0.82, 900 / 0.63),
    landscape = Math.min(700 / 0.63, 900 / 0.82);
  expect(duoOutputSide(700, 900, 1, 1)).toBe(Math.ceil(Math.max(portrait, landscape)));
  expect(duoOutputSide(800, 1400, 1, 1)).toBe(duoOutputSide(1400, 800, 1, 1));
});
