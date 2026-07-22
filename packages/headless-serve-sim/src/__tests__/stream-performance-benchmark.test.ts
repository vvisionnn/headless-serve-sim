import { describe, expect, test } from "bun:test";
import {
  assertIsolatedSimulator,
  derivePipelineMetrics,
  subtractNumericMetrics,
  summarizeProcessSamples,
} from "../../scripts/stream-performance-benchmark";

describe("stream performance benchmark", () => {
  test("accepts only the explicitly named, booted performance simulator", () => {
    const inventory = {
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          { udid: "SAFE", name: "serve-sim-perf-20260722", state: "Booted", isAvailable: true },
          { udid: "OTHER", name: "iPhone Air", state: "Booted", isAvailable: true },
        ],
      },
    };

    expect(assertIsolatedSimulator(inventory, "SAFE").udid).toBe("SAFE");
    expect(() => assertIsolatedSimulator(inventory, "OTHER")).toThrow("not isolated");
    expect(() => assertIsolatedSimulator(inventory, "MISSING")).toThrow("not found");
  });

  test("summarizes host CPU and resident memory samples", () => {
    expect(
      summarizeProcessSamples([
        { cpuPercent: 10, rssKb: 1000 },
        { cpuPercent: 30, rssKb: 3000 },
        { cpuPercent: 20, rssKb: 2000 },
      ]),
    ).toEqual({
      samples: 3,
      cpuAveragePercent: 20,
      cpuP95Percent: 30,
      cpuMaxPercent: 30,
      rssAverageMb: 1.95,
      rssMaxMb: 2.93,
    });
  });

  test("subtracts monotonic server metrics around one benchmark stage", () => {
    expect(
      subtractNumericMetrics(
        { framesOffered: 120, snapshotsRequired: 90, mode: "perf" },
        { framesOffered: 20, snapshotsRequired: 10, mode: "perf" },
      ),
    ).toEqual({ framesOffered: 100, snapshotsRequired: 80 });
  });

  test("derives copy avoidance and average socket-write latency", () => {
    expect(
      derivePipelineMetrics({
        framesOffered: 100,
        snapshotsSkippedBeforeCopy: 25,
        avccCompletedWrites: 4,
        avccWriteNanoseconds: 2_000_000,
      }),
    ).toMatchObject({
      copyAvoidancePercent: 25,
      avccAverageWriteMs: 0.5,
    });
  });
});
