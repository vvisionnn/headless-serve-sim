import { describe, expect, test } from "bun:test";
import {
  createDeviceMetadataResolver,
  type DeviceMetadataSource,
} from "../device-metadata";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";

const FRAME_WITHOUT_ARTWORK: DeviceFrameSpec = {
  deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  modelName: "iPhone 17 Pro",
  family: "iphone",
  nativeScreen: { width: 1206, height: 2622 },
  insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
  screenRadiiPx: { topLeft: 186, topRight: 186, bottomRight: 186, bottomLeft: 186 },
  outerRadiiPx: { x: 240, y: 240 },
  cutout: "dynamic-island",
  chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
};

const FRAME_WITH_ARTWORK: DeviceFrameSpec = {
  ...FRAME_WITHOUT_ARTWORK,
  artwork: {
    width: 1314,
    height: 2730,
    chromeRectPx: { x: 0, y: 0, width: 1314, height: 2730 },
    slices: {
      topLeft: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      top: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      topRight: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      right: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      bottomRight: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      bottom: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      bottomLeft: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
      left: { pngDataUrl: "data:image/png;base64,AA==", width: 1, height: 1 },
    },
    controls: [],
  },
};

function source(
  load: DeviceMetadataSource["loadDeviceFrameSpec"],
): DeviceMetadataSource {
  return {
    findSimulator: async () => ({
      udid: "DEVICE-1",
      name: "My iPhone",
      deviceTypeIdentifier: FRAME_WITHOUT_ARTWORK.deviceTypeIdentifier,
    }),
    loadDeviceFrameSpec: load,
  };
}

describe("device metadata resolver", () => {
  test("retries a geometry-only frame and keeps prepared artwork cached", async () => {
    let now = 1_000;
    let loads = 0;
    const resolver = createDeviceMetadataResolver(source(async () => {
      loads++;
      return loads === 1 ? FRAME_WITHOUT_ARTWORK : FRAME_WITH_ARTWORK;
    }), { now: () => now });

    expect((await resolver.resolve("DEVICE-1"))?.deviceFrameSpec?.artwork).toBeUndefined();
    expect(loads).toBe(1);

    expect((await resolver.resolve("DEVICE-1"))?.deviceFrameSpec?.artwork).toBeUndefined();
    expect(loads).toBe(1);

    now += 5_000;
    expect((await resolver.resolve("DEVICE-1"))?.deviceFrameSpec?.artwork).toBeDefined();
    expect(loads).toBe(2);

    now += 60_000;
    await resolver.resolve("DEVICE-1");
    expect(loads).toBe(2);
  });

  test("shares one asynchronous load between concurrent preview requests", async () => {
    let release: (frame: DeviceFrameSpec | null) => void = () => {};
    const pending = new Promise<DeviceFrameSpec | null>((resolve) => {
      release = resolve;
    });
    let loads = 0;
    const resolver = createDeviceMetadataResolver(source(() => {
      loads++;
      return pending;
    }));

    const first = resolver.resolve("DEVICE-1");
    const second = resolver.resolve("DEVICE-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(1);

    release(FRAME_WITH_ARTWORK);
    await expect(first).resolves.toMatchObject({ deviceFrameSpec: FRAME_WITH_ARTWORK });
    await expect(second).resolves.toMatchObject({ deviceFrameSpec: FRAME_WITH_ARTWORK });
  });
});
