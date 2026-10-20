import { expect, test } from "bun:test";
import {
  NATURAL_ROOM,
  naturalZoom,
  readDeviceZoom,
  realSizeScale,
  writeDeviceZoom,
} from "../client/utils/natural-device-size";

test("a device's real size is its pixels in CSS inches", () => {
  // iPhone Air: 460 ppi, so one CSS inch (96px) covers 460 screen pixels.
  expect(realSizeScale({ screenPixelsPerInch: 460 })).toBeCloseTo(96 / 460);
  expect(realSizeScale({})).toBeNull();
  expect(realSizeScale({ screenPixelsPerInch: 0 })).toBeNull();
});

test("a device opens at its real size when that fits with room around it", () => {
  // Real size 600px tall on a stage that would fit it at 900px.
  expect(naturalZoom(600, 900)).toBeCloseTo(600 / 900);
});

test("a device too big for the stage opens with room around it, not filling it", () => {
  // A 13-inch iPad (about 1000px real) on a stage that fits it at 800px.
  expect(naturalZoom(1000, 800)).toBe(NATURAL_ROOM);
  expect(NATURAL_ROOM).toBeLessThan(1);
});

test("without a known density a device still opens with room around it", () => {
  expect(naturalZoom(null, 800)).toBe(NATURAL_ROOM);
  expect(naturalZoom(600, 0)).toBe(NATURAL_ROOM);
});

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

test("a chosen size is remembered per device model", () => {
  const storage = memoryStorage();
  expect(readDeviceZoom(storage, "iPhone-Air")).toBeNull();
  writeDeviceZoom(storage, "iPhone-Air", 0.7);
  expect(readDeviceZoom(storage, "iPhone-Air")).toBe(0.7);
  expect(readDeviceZoom(storage, "iPad-mini")).toBeNull();
  writeDeviceZoom(storage, "iPhone-Air", null);
  expect(readDeviceZoom(storage, "iPhone-Air")).toBeNull();
});

test("an unusable stored size or storage falls back to the natural size", () => {
  const storage = memoryStorage();
  storage.setItem("serve-sim:device-zoom:iPhone-Air", "nonsense");
  expect(readDeviceZoom(storage, "iPhone-Air")).toBeNull();
  expect(readDeviceZoom(storage, undefined)).toBeNull();
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {},
  };
  expect(readDeviceZoom(broken, "iPhone-Air")).toBeNull();
  expect(() => writeDeviceZoom(broken, "iPhone-Air", 0.5)).not.toThrow();
});
