import { describe, expect, test } from "bun:test";
import { buildDeviceFrameSpec } from "../device-frame-profile";

const iphone17Pro = {
  identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  name: "iPhone 17 Pro",
  productFamily: "iPhone",
  bundlePath: "/DeviceTypes/iPhone 17 Pro.simdevicetype",
};

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: {
      DeviceSupportsDynamicIsland: true,
      displays: [{
        deviceName: "primary",
        displayType: "integrated",
        width: 1206,
        height: 2622,
        scale: 3,
        cornerRadiusUL: 62,
        cornerRadiusUR: 62,
        cornerRadiusLR: 62,
        cornerRadiusLL: 62,
      }],
      ...overrides,
    },
  };
}

const chrome = {
  identifier: "com.apple.dt.devicekit.chrome.phone11",
  images: {
    sizing: { leftWidth: 18, rightWidth: 18, topHeight: 18, bottomHeight: 18 },
  },
  paths: {
    simpleOutsideBorder: {
      insets: { top: 1, right: 2, bottom: 3, left: 4 },
      cornerRadiusX: 80,
      cornerRadiusY: 80,
    },
  },
};

describe("buildDeviceFrameSpec", () => {
  test("builds exact native-pixel geometry from CoreSimulator and DeviceKit", () => {
    expect(buildDeviceFrameSpec({
      deviceType: iphone17Pro,
      capabilities: capabilities(),
      profile: {
        chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
        sensorBarImage: "sensor_bar_class_04",
      },
      chrome,
    })).toEqual({
      deviceTypeIdentifier: iphone17Pro.identifier,
      modelName: "iPhone 17 Pro",
      family: "iphone",
      nativeScreen: { width: 1206, height: 2622 },
      insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
      screenRadiiPx: { topLeft: 186, topRight: 186, bottomRight: 186, bottomLeft: 186 },
      outerRadiiPx: { x: 240, y: 240 },
      outerInsetsPx: { top: 3, right: 6, bottom: 9, left: 12 },
      cutout: "dynamic-island",
      cutoutRectPx: null,
      chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
    });
  });

  test("uses notch metadata instead of drawing an Island on every iPhone", () => {
    expect(buildDeviceFrameSpec({
      deviceType: { ...iphone17Pro, identifier: "type.iphone-16e", name: "iPhone 16e" },
      capabilities: capabilities({ DeviceSupportsDynamicIsland: false }),
      profile: {
        chromeIdentifier: "com.apple.dt.devicekit.chrome.phone13",
        sensorBarImage: "sensor_bar_class_03",
      },
      sensorBarSize: { width: 176, height: 34 },
      chrome: { ...chrome, identifier: "com.apple.dt.devicekit.chrome.phone13" },
    })).toMatchObject({
      cutout: "notch",
      cutoutRectPx: { x: 339, y: 0, width: 528, height: 102 },
    });
  });

  test("returns null rather than inventing a phone frame for unsupported profiles", () => {
    expect(buildDeviceFrameSpec({
      deviceType: { ...iphone17Pro, productFamily: "Apple Vision" },
      capabilities: capabilities(),
      profile: {},
      chrome: {},
    })).toBeNull();
  });
});
