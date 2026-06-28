import { beforeAll, describe, expect, test } from "bun:test";
import { fitDeviceFrame } from "../client/utils/frame-geometry";

// roundToDevicePixel reads window.devicePixelRatio. Pin dpr=1 so the rounding
// is a deterministic Math.round(value) and these expectations are exact.
beforeAll(() => {
  (globalThis as { window?: unknown; devicePixelRatio?: number }).window = {
    devicePixelRatio: 1,
  };
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
});

// Shared defaults mirroring client.tsx's layout constants.
const TOP_BAR = 44;
const BORDER = 2;
const MAX_SCALE = 3;

function fit(over: {
  viewportWidth?: number;
  viewportHeight?: number;
  topBarHeight?: number;
  sideRailsWidth?: number;
  assemblyBorder?: number;
  aspect?: number;
  maxWidth?: number;
  maxScale?: number;
}) {
  return fitDeviceFrame({
    viewportWidth: over.viewportWidth ?? 1200,
    viewportHeight: over.viewportHeight ?? 900,
    topBarHeight: over.topBarHeight ?? TOP_BAR,
    sideRailsWidth: over.sideRailsWidth ?? 0,
    assemblyBorder: over.assemblyBorder ?? BORDER,
    aspect: over.aspect ?? 0.5,
    maxWidth: over.maxWidth ?? 100000, // effectively no upscale cap unless overridden
    maxScale: over.maxScale ?? MAX_SCALE,
  });
}

describe("fitDeviceFrame — bounding", () => {
  test("portrait is height-bound: height fills the remaining height, width follows aspect", () => {
    // Tall viewport, narrow portrait device. availH dominates.
    const aspect = 0.5; // w = h * 0.5 (portrait)
    const r = fit({ viewportWidth: 2000, viewportHeight: 900, aspect });
    const availH = 900 - TOP_BAR - BORDER; // 854
    expect(r.height).toBe(Math.round(availH));
    expect(r.width).toBe(Math.round(availH * aspect));
  });

  test("landscape is width-bound: width clamps to availW, height follows aspect", () => {
    // Wide device in a comparatively short, narrow viewport → width clamps.
    const aspect = 2; // landscape, w = h * 2
    const r = fit({ viewportWidth: 800, viewportHeight: 2000, aspect });
    const availW = 800 - 0 - BORDER; // 798
    expect(r.width).toBe(Math.round(availW));
    expect(r.height).toBe(Math.round(availW / aspect));
  });
});

describe("fitDeviceFrame — upscale cap", () => {
  test("width never exceeds maxWidth * maxScale", () => {
    // Huge viewport but a low-res device: cap = 200 * 3 = 600.
    const aspect = 0.5;
    const r = fit({
      viewportWidth: 5000,
      viewportHeight: 5000,
      aspect,
      maxWidth: 200,
      maxScale: 3,
    });
    expect(r.width).toBe(600);
    expect(r.height).toBe(Math.round(600 / aspect)); // 1200
  });

  test("cap does not enlarge a frame already smaller than the cap", () => {
    const aspect = 0.5;
    const r = fit({
      viewportWidth: 400,
      viewportHeight: 900,
      aspect,
      maxWidth: 100000,
    });
    const availH = 900 - TOP_BAR - BORDER; // 854
    const availW = 400 - BORDER; // 398
    // height-bound candidate: h = min(854, 398/0.5=796) = 796, w = 398 (== availW, no clamp)
    expect(r.width).toBe(398);
    expect(r.height).toBe(Math.round(398 / aspect)); // 796
  });
});

describe("fitDeviceFrame — tiny viewport / non-negative invariant", () => {
  test("rails wider than the viewport clamp to non-negative width and height", () => {
    const r = fit({
      viewportWidth: 100,
      viewportHeight: 60,
      sideRailsWidth: 500, // exceeds the viewport width
      aspect: 0.5,
    });
    expect(r.width).toBeGreaterThanOrEqual(0);
    expect(r.height).toBeGreaterThanOrEqual(0);
    // availW floors at 0 → width 0; with aspect>0, height also collapses to 0.
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  test("top bar + border taller than the viewport clamps height to 0", () => {
    const r = fit({ viewportWidth: 1000, viewportHeight: 20, aspect: 0.5 });
    expect(r.height).toBe(0);
    expect(r.width).toBe(0); // width = h * aspect = 0
  });

  test("zero viewport yields zero geometry, never NaN or negative", () => {
    const r = fit({ viewportWidth: 0, viewportHeight: 0, aspect: 0.5 });
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
    expect(Number.isNaN(r.width)).toBe(false);
    expect(Number.isNaN(r.height)).toBe(false);
  });
});

describe("fitDeviceFrame — never-clip invariant", () => {
  // The bordered assembly must always fit the viewport: the frame plus the side
  // rails plus the reserved border must not exceed the viewport width, and the
  // frame plus top bar plus border must not exceed the viewport height. Rounding
  // can add at most a sub-pixel; allow a 1px slack for the device-pixel round.
  const cases = [
    { viewportWidth: 1440, viewportHeight: 900, sideRailsWidth: 88, aspect: 0.46 },
    { viewportWidth: 1024, viewportHeight: 1366, sideRailsWidth: 404, aspect: 0.75 },
    { viewportWidth: 375, viewportHeight: 812, sideRailsWidth: 44, aspect: 0.46 },
    { viewportWidth: 2560, viewportHeight: 1440, sideRailsWidth: 720, aspect: 2.1 },
    { viewportWidth: 600, viewportHeight: 600, sideRailsWidth: 44, aspect: 1 },
    { viewportWidth: 800, viewportHeight: 480, sideRailsWidth: 360, aspect: 1.5 },
  ];

  for (const c of cases) {
    test(`fits within ${c.viewportWidth}x${c.viewportHeight} (rails ${c.sideRailsWidth}, aspect ${c.aspect})`, () => {
      const r = fit({ ...c, maxWidth: 100000 });
      expect(r.width + c.sideRailsWidth + BORDER).toBeLessThanOrEqual(c.viewportWidth + 1);
      expect(r.height + TOP_BAR + BORDER).toBeLessThanOrEqual(c.viewportHeight + 1);
      expect(r.width).toBeGreaterThanOrEqual(0);
      expect(r.height).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("fitDeviceFrame — aspect guard", () => {
  test("aspect <= 0 is treated as 1 (square), not a divide-by-zero", () => {
    const r0 = fit({ viewportWidth: 1000, viewportHeight: 1000, aspect: 0 });
    const r1 = fit({ viewportWidth: 1000, viewportHeight: 1000, aspect: 1 });
    expect(r0).toEqual(r1);
    expect(Number.isFinite(r0.width)).toBe(true);
    expect(Number.isFinite(r0.height)).toBe(true);
  });

  test("negative aspect is also treated as 1", () => {
    const rNeg = fit({ viewportWidth: 1000, viewportHeight: 1000, aspect: -3 });
    const r1 = fit({ viewportWidth: 1000, viewportHeight: 1000, aspect: 1 });
    expect(rNeg).toEqual(r1);
  });
});
