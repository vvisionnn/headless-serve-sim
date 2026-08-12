import { describe, expect, test } from "bun:test";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { fitDeviceBezel } from "../client/utils/bezel-geometry";

// Modelled on a real installed profile (iPhone 17 Pro): the artwork is wider
// than the chrome because the side-button nubs stick out past it, and the screen
// sits inside the chrome by the insets.
const SPEC: DeviceFrameSpec = {
  deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  modelName: "iPhone 17 Pro",
  family: "iphone",
  nativeScreen: { width: 1206, height: 2622 },
  insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
  screenRadiiPx: { topLeft: 186, topRight: 186, bottomRight: 186, bottomLeft: 186 },
  outerRadiiPx: { x: 240, y: 240 },
  cutout: "dynamic-island",
  chromeIdentifier: "chrome",
  artwork: {
    width: 1368,
    height: 2730,
    chromeRectPx: { x: 27, y: 0, width: 1314, height: 2730 },
    slices: {} as never,
    controls: [],
  },
};

const NO_CAP = { maxScreenWidth: 1e6, maxScale: 1 };

describe("fitDeviceBezel", () => {
  test("fits the whole artwork, not just the screen, and places the screen inside it", () => {
    // Height-bound: 2730 * scale == 2730, so scale == 1.
    const g = fitDeviceBezel({
      spec: SPEC,
      rotation: 0,
      availWidth: 10_000,
      availHeight: 2730,
      ...NO_CAP,
    });
    expect(g.scale).toBeCloseTo(1, 6);
    expect(g.width).toBeCloseTo(1368, 6);
    expect(g.height).toBeCloseTo(2730, 6);
    // screen origin = chromeRect origin + insets
    expect(g.screen.x).toBeCloseTo(27 + 54, 6);
    expect(g.screen.y).toBeCloseTo(0 + 54, 6);
    expect(g.screen.width).toBeCloseTo(1206, 6);
    expect(g.screen.height).toBeCloseTo(2622, 6);
    expect(g.screenRadii.topLeft).toBeCloseTo(186, 6);
  });

  test("scales the screen rect and its radii by the same factor", () => {
    const g = fitDeviceBezel({
      spec: SPEC,
      rotation: 0,
      availWidth: 10_000,
      availHeight: 1365, // half height
      ...NO_CAP,
    });
    expect(g.scale).toBeCloseTo(0.5, 6);
    expect(g.screen.width).toBeCloseTo(603, 6);
    expect(g.screenRadii.bottomRight).toBeCloseTo(93, 6);
    expect(g.outerRadius).toBeCloseTo(120, 6);
  });

  test("width-bound when the space is short and wide", () => {
    const g = fitDeviceBezel({
      spec: SPEC,
      rotation: 0,
      availWidth: 684, // half the artwork width
      availHeight: 10_000,
      ...NO_CAP,
    });
    expect(g.scale).toBeCloseTo(0.5, 6);
    expect(g.width).toBeCloseTo(684, 6);
  });

  test("rotating 90° swaps the bounds and moves the screen with them", () => {
    const g = fitDeviceBezel({
      spec: SPEC,
      rotation: 90,
      availWidth: 2730,
      availHeight: 10_000,
      ...NO_CAP,
    });
    expect(g.scale).toBeCloseTo(1, 6);
    // bounds are transposed
    expect(g.width).toBeCloseTo(2730, 6);
    expect(g.height).toBeCloseTo(1368, 6);
    // screen is transposed too, and stays fully inside the artwork
    expect(g.screen.width).toBeCloseTo(2622, 6);
    expect(g.screen.height).toBeCloseTo(1206, 6);
    expect(g.screen.x).toBeGreaterThanOrEqual(0);
    expect(g.screen.y).toBeGreaterThanOrEqual(0);
    expect(g.screen.x + g.screen.width).toBeLessThanOrEqual(g.width + 1e-6);
    expect(g.screen.y + g.screen.height).toBeLessThanOrEqual(g.height + 1e-6);
  });

  test("the device-type cap limits the SCREEN width, not the artwork width", () => {
    // Cap the screen at 603 CSS px; the artwork may still be wider than that.
    const g = fitDeviceBezel({
      spec: SPEC,
      rotation: 0,
      availWidth: 10_000,
      availHeight: 10_000,
      maxScreenWidth: 603,
      maxScale: 1,
    });
    expect(g.screen.width).toBeCloseTo(603, 6);
    expect(g.scale).toBeCloseTo(0.5, 6);
    expect(g.width).toBeCloseTo(684, 6);
  });

  test("a profile with no artwork falls back to the chrome box", () => {
    const bare: DeviceFrameSpec = { ...SPEC, artwork: undefined };
    const g = fitDeviceBezel({
      spec: bare,
      rotation: 0,
      availWidth: 10_000,
      availHeight: 2730,
      ...NO_CAP,
    });
    // chrome = insets + native screen
    expect(g.width / g.scale).toBeCloseTo(54 + 1206 + 54, 6);
    expect(g.height / g.scale).toBeCloseTo(54 + 2622 + 54, 6);
    expect(g.screen.x / g.scale).toBeCloseTo(54, 6);
  });

  test("degenerate space yields a zero-size, non-negative geometry", () => {
    const g = fitDeviceBezel({
      spec: SPEC,
      rotation: 0,
      availWidth: 0,
      availHeight: 0,
      ...NO_CAP,
    });
    expect(g.scale).toBe(0);
    expect(g.width).toBe(0);
    expect(g.height).toBe(0);
    expect(g.screen.width).toBe(0);
  });
});
