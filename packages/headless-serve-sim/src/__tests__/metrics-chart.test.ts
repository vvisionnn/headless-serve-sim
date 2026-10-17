import { describe, expect, test } from "bun:test";
import { cpuTone, MEM_MIN_SPAN, memoryRange } from "../client/utils/metrics-chart";

describe("cpuTone", () => {
  test("null -> neutral", () => {
    expect(cpuTone(null)).toBe("neutral");
  });

  test(">=80 -> red (boundary inclusive at exactly 80)", () => {
    expect(cpuTone(80)).toBe("red");
    expect(cpuTone(99.9)).toBe("red");
    expect(cpuTone(250)).toBe("red");
  });

  test("just under 80 -> orange, not red", () => {
    expect(cpuTone(79.9)).toBe("orange");
  });

  test(">=50 -> orange (boundary inclusive at exactly 50)", () => {
    expect(cpuTone(50)).toBe("orange");
    expect(cpuTone(79)).toBe("orange");
  });

  test("just under 50 -> green, not orange", () => {
    expect(cpuTone(49.9)).toBe("green");
  });

  test("low / zero -> green", () => {
    expect(cpuTone(0)).toBe("green");
    expect(cpuTone(12.5)).toBe("green");
  });

  test("negative pct -> green (below all thresholds)", () => {
    expect(cpuTone(-5)).toBe("green");
  });
});

describe("memoryRange", () => {
  test("flat values: span floored to MEM_MIN_SPAN * 1.15, centered on the value", () => {
    const v = 500 * 1024 * 1024;
    const { yMin, yMax } = memoryRange([v, v, v], 0);
    const span = yMax - yMin;
    expect(span).toBeCloseTo(MEM_MIN_SPAN * 1.15, 0);
    // Centered on v (no clamp, since v sits well above the half-span).
    expect((yMin + yMax) / 2).toBeCloseTo(v, 0);
    expect(yMin).toBeGreaterThan(0);
  });

  test("never returns yMin < 0; overflow is pushed onto yMax", () => {
    // Small RSS so mid - span/2 would go negative and must clamp to 0.
    const v = 10 * 1024 * 1024;
    const { yMin, yMax } = memoryRange([v], v);
    expect(yMin).toBe(0);
    // Span is preserved when clamped (yMax absorbs the negative overflow).
    expect(yMax - yMin).toBeCloseTo(MEM_MIN_SPAN * 1.15, 0);
  });

  test("wide spread: span = (hi - lo) * 1.15 when it exceeds the floor", () => {
    const lo = 200 * 1024 * 1024;
    const hi = 1200 * 1024 * 1024;
    const { yMin, yMax } = memoryRange([lo, hi, lo + 1, hi - 1], 0);
    expect(yMax - yMin).toBeCloseTo((hi - lo) * 1.15, 0);
    expect((yMin + yMax) / 2).toBeCloseTo((hi + lo) / 2, 0);
  });

  test("empty values centers on fallbackRss (memLo treated as 0)", () => {
    const memory = 300 * 1024 * 1024;
    const { yMin, yMax } = memoryRange([], memory);
    // memHi=memory, memLo=0 -> mid = memory/2; span floored.
    const expectedSpan = Math.max(memory - 0, MEM_MIN_SPAN) * 1.15;
    let expMin = memory / 2 - expectedSpan / 2;
    let expMax = memory / 2 + expectedSpan / 2;
    if (expMin < 0) {
      expMax -= expMin;
      expMin = 0;
    }
    expect(yMin).toBeCloseTo(expMin, 0);
    expect(yMax).toBeCloseTo(expMax, 0);
    expect(yMin).toBeGreaterThanOrEqual(0);
  });

  test("empty values with zero fallback still clamps to 0 and keeps a floored span", () => {
    const { yMin, yMax } = memoryRange([], 0);
    expect(yMin).toBe(0);
    expect(yMax).toBeGreaterThan(0);
  });
});
