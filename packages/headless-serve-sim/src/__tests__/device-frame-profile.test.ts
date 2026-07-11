import { describe, expect, test } from "bun:test";
import {
  buildDeviceFrameSpec,
  parsePdfMediaBoxSize,
} from "../device-frame-profile";

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

const realChrome = {
  ...chrome,
  images: {
    ...chrome.images,
    topLeft: "Phone TL",
    top: "Phone Top",
    topRight: "Phone TR",
    right: "Phone Right",
    bottomRight: "Phone BR",
    bottom: "Phone Base",
    bottomLeft: "Phone BL",
    left: "Phone Left",
    screen: "Screen",
    devicePadding: { top: 0, right: 9, bottom: 0, left: 9 },
  },
  inputs: [
    {
      name: "action",
      type: "button",
      image: "Mute BTN",
      onTop: false,
      anchor: "left",
      align: "leading",
      offsets: { normal: { x: 8, y: 160 }, rollover: { x: 3, y: 160 } },
    },
    {
      name: "power",
      type: "button",
      image: "X_Power BTN",
      onTop: false,
      anchor: "right",
      align: "leading",
      offsets: { normal: { x: -8, y: 262 }, rollover: { x: -3, y: 262 } },
    },
    {
      name: "volume-up",
      type: "button",
      image: "Volume BTN",
      onTop: false,
      anchor: "left",
      align: "leading",
      offsets: { normal: { x: 8, y: 221 }, rollover: { x: 3, y: 221 } },
    },
    {
      name: "volume-down",
      type: "button",
      image: "Volume BTN",
      onTop: false,
      anchor: "left",
      align: "leading",
      offsets: { normal: { x: 8, y: 300 }, rollover: { x: 3, y: 300 } },
    },
  ],
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

  test("preserves real DeviceKit metal slices and physical-control geometry", () => {
    const mediaBoxes: Record<string, { width: number; height: number }> = {
      "Phone TL": { width: 110, height: 110 },
      "Phone Top": { width: 1, height: 110 },
      "Phone TR": { width: 110, height: 110 },
      "Phone Right": { width: 110, height: 1 },
      "Phone BR": { width: 110, height: 110 },
      "Phone Base": { width: 1, height: 110 },
      "Phone BL": { width: 110, height: 110 },
      "Phone Left": { width: 110, height: 1 },
      "Mute BTN": { width: 16, height: 34 },
      "X_Power BTN": { width: 16, height: 101 },
      "Volume BTN": { width: 16, height: 64 },
    };
    const frame = buildDeviceFrameSpec({
      deviceType: iphone17Pro,
      capabilities: capabilities(),
      profile: { chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11" },
      chrome: realChrome,
      resolveArtworkAsset: (name, scale) => {
        const size = mediaBoxes[name];
        return size
          ? {
              pngDataUrl: `data:image/png;base64,${name}`,
              width: size.width * scale,
              height: size.height * scale,
            }
          : null;
      },
    });

    expect(frame?.artwork).toMatchObject({
      width: 1368,
      height: 2730,
      chromeRectPx: { x: 27, y: 0, width: 1314, height: 2730 },
      slices: {
        topLeft: { width: 330, height: 330 },
        top: { width: 3, height: 330 },
        right: { width: 330, height: 3 },
      },
      controls: [
        {
          name: "action",
          anchor: "left",
          align: "leading",
          onTop: false,
          image: { width: 48, height: 102 },
          normalOffsetPx: { x: 24, y: 480 },
          rolloverOffsetPx: { x: 9, y: 480 },
        },
        {
          name: "power",
          anchor: "right",
          align: "leading",
          onTop: false,
          image: { width: 48, height: 303 },
          normalOffsetPx: { x: -24, y: 786 },
          rolloverOffsetPx: { x: -9, y: 786 },
        },
        {
          name: "volume-up",
          anchor: "left",
          image: { width: 48, height: 192 },
          normalOffsetPx: { x: 24, y: 663 },
          rolloverOffsetPx: { x: 9, y: 663 },
        },
        {
          name: "volume-down",
          anchor: "left",
          image: { width: 48, height: 192 },
          normalOffsetPx: { x: 24, y: 900 },
          rolloverOffsetPx: { x: 9, y: 900 },
        },
      ],
    });
  });

  test("rejects incomplete artwork instead of silently dropping a hardware control", () => {
    const frame = buildDeviceFrameSpec({
      deviceType: iphone17Pro,
      capabilities: capabilities(),
      profile: { chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11" },
      chrome: realChrome,
      resolveArtworkAsset: (name) => name === "X_Power BTN"
        ? null
        : { pngDataUrl: name, width: 3, height: 3 },
    });

    expect(frame).not.toHaveProperty("artwork");
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

describe("parsePdfMediaBoxSize", () => {
  test("subtracts non-zero PDF origins from the upper-right coordinates", () => {
    expect(parsePdfMediaBoxSize("/MediaBox [ 12 -4 112 196 ]")).toEqual({
      width: 100,
      height: 200,
    });
  });
});
