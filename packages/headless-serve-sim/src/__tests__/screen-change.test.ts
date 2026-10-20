import { describe, expect, test } from "bun:test";
import {
  REVEAL_FALLBACK_MS,
  luminanceGrid,
  revealShouldStart,
  screenChanged,
} from "../client/utils/screen-change";

/** An RGBA buffer of `count` pixels, all one grey. */
function grey(count: number, value: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) data.set([value, value, value, 255], i * 4);
  return data;
}

describe("luminanceGrid", () => {
  test("reads one luminance per RGBA pixel", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    const grid = luminanceGrid(data);
    expect(grid.length).toBe(3);
    expect(grid[0]).toBeCloseTo(255, 0);
    expect(grid[1]).toBe(0);
    expect(grid[2]).toBeGreaterThan(40);
    expect(grid[2]).toBeLessThan(80);
  });
});

describe("screenChanged", () => {
  test("a light screen turning dark is a change", () => {
    expect(screenChanged(luminanceGrid(grey(256, 240)), luminanceGrid(grey(256, 20)))).toBe(true);
  });

  test("the same frame, or encoder noise, is not", () => {
    const base = luminanceGrid(grey(256, 240));
    expect(screenChanged(base, base)).toBe(false);
    expect(screenChanged(base, luminanceGrid(grey(256, 232)))).toBe(false);
  });

  test("a small region moving (a clock, a spinner) is not", () => {
    const next = grey(256, 240);
    for (let i = 0; i < 20; i++) next.set([0, 0, 0, 255], i * 4);
    expect(screenChanged(luminanceGrid(grey(256, 240)), luminanceGrid(next))).toBe(false);
  });

  test("grids of different sizes can't be compared", () => {
    expect(screenChanged(luminanceGrid(grey(16, 240)), luminanceGrid(grey(256, 0)))).toBe(false);
  });
});

describe("revealShouldStart", () => {
  test("starts on the first changed frame", () => {
    expect(revealShouldStart({ changed: true, elapsedMs: 16 })).toBe(true);
    expect(revealShouldStart({ changed: false, elapsedMs: 600 })).toBe(false);
  });

  test("starts anyway once the fallback passes, so a missed change never strands the wipe", () => {
    expect(revealShouldStart({ changed: false, elapsedMs: REVEAL_FALLBACK_MS })).toBe(true);
    expect(REVEAL_FALLBACK_MS).toBeGreaterThanOrEqual(800);
    expect(REVEAL_FALLBACK_MS).toBeLessThanOrEqual(1200);
  });
});
