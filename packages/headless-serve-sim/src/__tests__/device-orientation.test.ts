import { expect, test } from "bun:test";
import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";
import {
  screenOrientationForDevice,
  withDeviceOrientation,
} from "../client/utils/device-orientation";

test("devicectl's physical orientation maps to the stream's vocabulary", () => {
  // The device turned counter-clockwise (top to the left) is UIDevice
  // landscapeLeft, drawn as the interface's landscape right.
  expect(screenOrientationForDevice("landscapeLeft")).toBe("landscape_right");
  expect(screenOrientationForDevice("landscapeRight")).toBe("landscape_left");
  expect(screenOrientationForDevice("portraitUpsideDown")).toBe("portrait_upside_down");
  expect(screenOrientationForDevice("portrait")).toBe("portrait");
  // Flat or unknown says nothing about which way the screen faces.
  expect(screenOrientationForDevice("faceUp")).toBeNull();
  expect(screenOrientationForDevice(null)).toBeNull();
});

test("the device's orientation, not the app's, decides how the panel is drawn", () => {
  // The home screen stays portrait while the device is held sideways.
  const reported: { width: number; height: number; orientation?: SimulatorOrientation } = {
    width: 1260,
    height: 2736,
    orientation: "portrait",
  };
  expect(withDeviceOrientation(reported, "landscape_right")).toEqual({
    ...reported,
    orientation: "landscape_right",
  });
  expect(withDeviceOrientation(reported, null)).toBe(reported);
});

test("a composited stream draws its own rotation and is left alone", () => {
  const composite = { width: 1000, height: 1000, deviceComposition: true };
  expect(withDeviceOrientation(composite, "landscape_left")).toBe(composite);
});
