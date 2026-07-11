import { describe, expect, test } from "bun:test";
import {
  matchDeviceFrameSpec,
  type DeviceFrameSpec,
} from "../simulator/device-frame-spec";

function spec(
  deviceTypeIdentifier: string,
  modelName: string,
  family: DeviceFrameSpec["family"],
  width: number,
  height: number,
): DeviceFrameSpec {
  return {
    deviceTypeIdentifier,
    modelName,
    family,
    nativeScreen: { width, height },
    insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
    screenRadiiPx: { topLeft: 186, topRight: 186, bottomRight: 186, bottomLeft: 186 },
    outerRadiiPx: { x: 240, y: 240 },
    cutout: "dynamic-island",
    chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
  };
}

const specs = [
  spec("type.iphone-17-pro", "iPhone 17 Pro", "iphone", 1206, 2622),
  spec("type.iphone-17", "iPhone 17", "iphone", 1206, 2622),
  spec("type.ipad-pro-13", "iPad Pro 13-inch (M5)", "ipad", 2064, 2752),
];

describe("matchDeviceFrameSpec", () => {
  test("uses the immutable type identifier even when the simulator was renamed", () => {
    const match = matchDeviceFrameSpec({
      deviceTypeIdentifier: "type.iphone-17-pro",
      modelName: "My renamed test simulator",
      family: "iphone",
    }, { width: 1206, height: 2622 }, specs);

    expect(match.matchedBy).toBe("identifier");
    expect(match.spec?.modelName).toBe("iPhone 17 Pro");
  });

  test("identifier wins over a conflicting instance name", () => {
    expect(matchDeviceFrameSpec({
      deviceTypeIdentifier: "type.iphone-17-pro",
      modelName: "iPhone 17",
      family: "iphone",
    }, { width: 1206, height: 2622 }, specs).spec?.modelName).toBe("iPhone 17 Pro");
  });

  test("matches canonical name, then unique portrait or landscape geometry", () => {
    expect(matchDeviceFrameSpec({ modelName: "iPad Pro 13-inch (M5)", family: "ipad" }, {
      width: 1,
      height: 1,
    }, specs).matchedBy).toBe("name");
    expect(matchDeviceFrameSpec({ family: "ipad" }, {
      width: 2752,
      height: 2064,
    }, specs)).toMatchObject({ matchedBy: "geometry", spec: { modelName: "iPad Pro 13-inch (M5)" } });
  });

  test("does not invent a model when geometry is ambiguous", () => {
    expect(matchDeviceFrameSpec({ family: "iphone" }, {
      width: 1206,
      height: 2622,
    }, specs)).toEqual({ spec: null, matchedBy: "none" });
  });
});
