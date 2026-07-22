import { describe, expect, test } from "bun:test";
import {
  improvementPercent,
  renderPerformanceReport,
} from "../../scripts/stream-performance-report";

describe("stream performance report", () => {
  test("scores higher-throughput and lower-latency metrics in the desired direction", () => {
    expect(improvementPercent(50, 60, "higher")).toBe(20);
    expect(improvementPercent(20, 15, "lower")).toBe(25);
    expect(improvementPercent(0, 0, "lower")).toBeNull();
  });

  test("renders stage-by-stage values and quality guards", () => {
    const report = renderPerformanceReport(
      {
        label: "baseline",
        result: {
          quality: {
            averageFps: 50,
            tornFrames: 0,
            invalidFrames: 0,
            frameIntervals: { p99Ms: 25 },
          },
        },
      },
      [
        {
          label: "bounded queue",
          result: {
            quality: {
              averageFps: 60,
              tornFrames: 0,
              invalidFrames: 0,
              frameIntervals: { p99Ms: 20 },
            },
          },
        },
      ],
    );

    expect(report).toContain("## bounded queue");
    expect(report).toContain("| Average FPS | 50 fps | 60 fps | +20% |");
    expect(report).toContain("| Frame interval p99 | 25 ms | 20 ms | +20% |");
    expect(report).toContain("0 torn frames; 0 invalid frames");
  });
});
