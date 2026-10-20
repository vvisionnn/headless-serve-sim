import { expect, test } from "bun:test";
import { getDeviceResizeScale, type DeviceResizeHandle } from "../client/utils/device-resize";

const handles: DeviceResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

test("centered edge drags preserve the fitted frame's scale in either orientation", () => {
  for (const fittedSize of [
    { width: 300, height: 600 },
    { width: 600, height: 300 },
    { width: 400, height: 400 },
  ]) {
    for (const [handle, deltaX, deltaY] of [
      ["e", fittedSize.width * 0.1, 100],
      ["w", -fittedSize.width * 0.1, 100],
      ["s", 100, fittedSize.height * 0.1],
      ["n", 100, -fittedSize.height * 0.1],
    ] as const) {
      const scale = getDeviceResizeScale({
        handle,
        fittedSize,
        availableSize: { width: 1200, height: 1200 },
        startScale: 0.6,
        deltaX,
        deltaY,
      });
      expect(scale).toBeCloseTo(0.8);
    }
  }
});

test("corner drags project both axes onto the frame aspect ratio", () => {
  for (const fittedSize of [
    { width: 300, height: 600 },
    { width: 600, height: 300 },
    { width: 400, height: 400 },
  ]) {
    for (const [handle, x, y] of [
      ["ne", 1, -1],
      ["se", 1, 1],
      ["sw", -1, 1],
      ["nw", -1, -1],
    ] as const) {
      const input = {
        handle,
        fittedSize,
        availableSize: { width: 1200, height: 1200 },
        startScale: 0.6,
      };
      expect(
        getDeviceResizeScale({
          ...input,
          deltaX: x * fittedSize.width * 0.1,
          deltaY: y * fittedSize.height * 0.1,
        }),
      ).toBeCloseTo(0.8);
      expect(
        getDeviceResizeScale({
          ...input,
          deltaX: x * fittedSize.height * 0.1,
          deltaY: -y * fittedSize.width * 0.1,
        }),
      ).toBeCloseTo(0.6);
    }
  }
});

test("all handles clamp scale to the canvas and the minimum", () => {
  for (const handle of handles) {
    const x = handle.includes("w") ? -1 : 1;
    const y = handle.includes("n") ? -1 : 1;
    const input = {
      handle,
      fittedSize: { width: 300, height: 600 },
      availableSize: { width: 350, height: 660 },
      startScale: 0.8,
    };
    expect(getDeviceResizeScale({ ...input, deltaX: x * 10_000, deltaY: y * 10_000 })).toBe(1.1);
    expect(getDeviceResizeScale({ ...input, deltaX: -x * 10_000, deltaY: -y * 10_000 })).toBe(0.25);
  }
});

test("drag starts from the visible capped scale instead of a hidden zoom overshoot", () => {
  expect(
    getDeviceResizeScale({
      handle: "e",
      fittedSize: { width: 300, height: 600 },
      availableSize: { width: 300, height: 600 },
      startScale: 2,
      deltaX: -30,
      deltaY: 0,
    }),
  ).toBeCloseTo(0.8);
});

test("Duo resizing clamps to its fixed envelope before and after rotation", () => {
  for (const fittedSize of [
    { width: 620, height: 443 },
    { width: 443, height: 620 },
  ]) {
    const input = {
      handle: "e" as const,
      fittedSize,
      availableSize: { width: 1400, height: 800 },
      maxScale: 800 / 620,
      startScale: 1.7,
      deltaY: 0,
    };
    expect(getDeviceResizeScale({ ...input, deltaX: 0 })).toBeCloseTo(800 / 620);
    expect(getDeviceResizeScale({ ...input, deltaX: -30 })).toBeCloseTo(
      800 / 620 - 60 / fittedSize.width,
    );
  }
});

test("empty canvas or frame returns finite zero scale", () => {
  for (const fittedSize of [
    { width: 0, height: 0 },
    { width: 0, height: 600 },
  ]) {
    expect(
      getDeviceResizeScale({
        handle: "se",
        fittedSize,
        availableSize: { width: 0, height: 0 },
        startScale: 1,
        deltaX: 10,
        deltaY: 10,
      }),
    ).toBe(0);
  }
});

test("canvas bounds override the minimum when space is smaller than a quarter of the fit", () => {
  expect(
    getDeviceResizeScale({
      handle: "se",
      fittedSize: { width: 300, height: 600 },
      availableSize: { width: 90, height: 90 },
      startScale: 1,
      deltaX: -10_000,
      deltaY: -10_000,
    }),
  ).toBe(0.15);
});
