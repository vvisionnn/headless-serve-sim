import { describe, expect, test, beforeAll } from "bun:test";
import { getDeviceType, simulatorMaxWidth } from "headless-serve-sim-client/simulator";
import { fitDeviceFrame } from "../client/utils/frame-geometry";

// roundToDevicePixel (inside fitDeviceFrame) reads window.devicePixelRatio.
beforeAll(() => {
  (globalThis as { window?: unknown; devicePixelRatio?: number }).window = { devicePixelRatio: 1 };
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
});

// A tall viewport where the per-device-type upscale cap actually binds — the
// condition that reproduced the "frame grows to fill height a few seconds after
// load" bug on an iPad preview.
const VIEWPORT = {
  viewportWidth: 1280,
  viewportHeight: 1600,
  topBarHeight: 44,
  sideRailsWidth: 88,
  assemblyBorder: 2,
  maxScale: 3,
};
const iPad = { width: 2064, height: 2752, orientation: "portrait" as const };
const aspect = iPad.width / iPad.height;

function frameForDeviceName(deviceName: string | null) {
  const type = getDeviceType(deviceName);
  return fitDeviceFrame({ ...VIEWPORT, aspect, maxWidth: simulatorMaxWidth(type, iPad) });
}

describe("device-type size cap — no first-paint resize (regression)", () => {
  test("injected iPad name sizes the frame identically to the resolved device", () => {
    // First paint with the baked-in __SIM_PREVIEW__.deviceName.
    const firstPaint = frameForDeviceName("iPad Pro 13-inch (M5)");
    // A moment later the async device list resolves to the same device.
    const resolved = frameForDeviceName("iPad Pro 13-inch (M5)");
    expect(firstPaint.height).toBe(resolved.height);
    expect(firstPaint.width).toBe(resolved.width);
  });

  test("without a device name the frame is capped smaller — the bug this fixes", () => {
    // The old first paint: deviceType defaults to "iphone" (name not yet known),
    // so the iPhone max-width cap clamps the iPad frame below full height.
    const unnamed = frameForDeviceName(null);
    const resolved = frameForDeviceName("iPad Pro 13-inch (M5)");
    expect(getDeviceType(null)).toBe("iphone");
    expect(unnamed.height).toBeLessThan(resolved.height);
  });
});
