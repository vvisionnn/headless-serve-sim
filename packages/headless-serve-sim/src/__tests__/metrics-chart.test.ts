import { describe, expect, test } from "bun:test";
import {
  buildSparkline,
  cpuColor,
  MEM_MIN_SPAN,
  memoryRange,
  splitValueUnit,
  type Sparkline,
} from "../client/utils/metrics-chart";

// Matches the hook's bound; buildSparkline takes it as a parameter now.
const MAX_SAMPLES = 48;

describe("cpuColor", () => {
  test("null -> neutral fg-3", () => {
    expect(cpuColor(null)).toBe("var(--color-fg-3)");
  });

  test(">=80 -> danger (boundary inclusive at exactly 80)", () => {
    expect(cpuColor(80)).toBe("var(--color-danger)");
    expect(cpuColor(99.9)).toBe("var(--color-danger)");
    expect(cpuColor(250)).toBe("var(--color-danger)");
  });

  test("just under 80 -> warning, not danger", () => {
    expect(cpuColor(79.9)).toBe("var(--color-warning)");
  });

  test(">=50 -> warning (boundary inclusive at exactly 50)", () => {
    expect(cpuColor(50)).toBe("var(--color-warning)");
    expect(cpuColor(79)).toBe("var(--color-warning)");
  });

  test("just under 50 -> success, not warning", () => {
    expect(cpuColor(49.9)).toBe("var(--color-success)");
  });

  test("low / zero -> success", () => {
    expect(cpuColor(0)).toBe("var(--color-success)");
    expect(cpuColor(12.5)).toBe("var(--color-success)");
  });

  test("negative pct -> success (below all thresholds)", () => {
    expect(cpuColor(-5)).toBe("var(--color-success)");
  });
});

describe("splitValueUnit", () => {
  test("'219 MB' -> ['219', 'MB']", () => {
    expect(splitValueUnit("219 MB")).toEqual(["219", "MB"]);
  });

  test("'1.2 GB' -> ['1.2', 'GB']", () => {
    expect(splitValueUnit("1.2 GB")).toEqual(["1.2", "GB"]);
  });

  test("em-dash placeholder -> ['—', '']", () => {
    expect(splitValueUnit("—")).toEqual(["—", ""]);
  });

  test("no space -> whole string as value, empty unit", () => {
    expect(splitValueUnit("512MB")).toEqual(["512MB", ""]);
    expect(splitValueUnit("")).toEqual(["", ""]);
  });

  test("splits only on the first space", () => {
    expect(splitValueUnit("1 234 MB")).toEqual(["1", "234 MB"]);
  });
});

describe("memoryRange", () => {
  test("flat values: span floored to MEM_MIN_SPAN * 1.15, centered on the value", () => {
    const v = 500 * 1024 * 1024;
    const { yMin, yMax } = memoryRange([v, v, v], 0);
    const span = (yMax - yMin);
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
    const rss = 300 * 1024 * 1024;
    const { yMin, yMax } = memoryRange([], rss);
    // memHi=rss, memLo=0 -> mid = rss/2; span floored.
    const expectedSpan = Math.max(rss - 0, MEM_MIN_SPAN) * 1.15;
    let expMin = rss / 2 - expectedSpan / 2;
    let expMax = rss / 2 + expectedSpan / 2;
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

describe("buildSparkline", () => {
  const W = 200;
  const H = 80;
  const baseY = H - 4; // 76

  test("fewer than 2 values -> null", () => {
    expect(buildSparkline([], 0, 100, W, H, MAX_SAMPLES)).toBeNull();
    expect(buildSparkline([42], 0, 100, W, H, MAX_SAMPLES)).toBeNull();
  });

  test("zero width or height -> null", () => {
    expect(buildSparkline([1, 2], 0, 100, 0, H, MAX_SAMPLES)).toBeNull();
    expect(buildSparkline([1, 2], 0, 100, W, 0, MAX_SAMPLES)).toBeNull();
    expect(buildSparkline([1, 2], 0, 100, -5, H, MAX_SAMPLES)).toBeNull();
  });

  test("newest sample is right-anchored at x = w; tip is the last point", () => {
    const spark = buildSparkline([10, 20, 30], 0, 100, W, H, MAX_SAMPLES) as Sparkline;
    expect(spark).not.toBeNull();
    expect(spark.tip[0]).toBeCloseTo(W, 5);
    // tip y reflects the last value (30 of [0,100]) above the baseline.
    expect(spark.tip[1]).toBeLessThan(baseY);
    // line ends at the tip coordinate.
    expect(spark.line.endsWith(`${spark.tip[0].toFixed(1)} ${spark.tip[1].toFixed(1)}`)).toBe(true);
  });

  test("samples are spaced dx = w/(maxSamples-1) apart, right to left", () => {
    const spark = buildSparkline([10, 20, 30], 0, 100, W, H, MAX_SAMPLES) as Sparkline;
    const dx = W / (MAX_SAMPLES - 1);
    // Pull the three x coords out of the line path "Mx y Lx y Lx y".
    const xs = spark.line
      .replace(/^M/, "")
      .split(" L")
      .map((seg) => parseFloat(seg.split(" ")[0]!));
    expect(xs).toHaveLength(3);
    // Coords are serialized via toFixed(1), so interior points match at 0.1px.
    expect(xs[2]).toBeCloseTo(W, 5); // newest pinned right (exact: w - 0)
    expect(xs[1]).toBeCloseTo(W - dx, 1);
    expect(xs[0]).toBeCloseTo(W - 2 * dx, 1);
  });

  test("flat series renders a horizontal line strictly above the baseline", () => {
    const v = 50; // mid of [0,100]
    const spark = buildSparkline([v, v, v, v], 0, 100, W, H, MAX_SAMPLES) as Sparkline;
    const ys = spark.line
      .replace(/^M/, "")
      .split(" L")
      .map((seg) => parseFloat(seg.split(" ")[1]!));
    // All y equal (flat).
    for (const y of ys) expect(y).toBeCloseTo(ys[0]!, 5);
    // And clearly above the baseline, never glued to it.
    expect(ys[0]).toBeLessThan(baseY);
    expect(ys[0]).toBeGreaterThan(0);
  });

  test("area path closes down to the baseline and back, with Z", () => {
    const spark = buildSparkline([10, 90], 0, 100, W, H, MAX_SAMPLES) as Sparkline;
    const xN = spark.tip[0]; // last x (= W)
    const dx = W / (MAX_SAMPLES - 1);
    const x0 = W - dx; // first x for 2 samples
    expect(spark.area.startsWith(spark.line)).toBe(true);
    expect(spark.area).toContain(`L${xN.toFixed(1)} ${baseY.toFixed(1)}`);
    expect(spark.area).toContain(`L${x0.toFixed(1)} ${baseY.toFixed(1)}`);
    expect(spark.area.endsWith("Z")).toBe(true);
  });

  test("values above yMax / below yMin clamp into the band", () => {
    const spark = buildSparkline([-50, 200], 0, 100, W, H, MAX_SAMPLES) as Sparkline;
    const ys = spark.line
      .replace(/^M/, "")
      .split(" L")
      .map((seg) => parseFloat(seg.split(" ")[1]!));
    const topPad = 6;
    // 200 clamps to yMax -> top of usable band (y = topPad).
    expect(ys[1]).toBeCloseTo(topPad, 5);
    // -50 clamps to yMin -> bottom of usable band (y = baseY).
    expect(ys[0]).toBeCloseTo(baseY, 5);
  });

  test("degenerate yMin==yMax span falls back to 1 (no divide-by-zero)", () => {
    const spark = buildSparkline([5, 5], 5, 5, W, H, MAX_SAMPLES) as Sparkline;
    expect(spark).not.toBeNull();
    for (const c of spark.tip) expect(Number.isFinite(c)).toBe(true);
  });
});
