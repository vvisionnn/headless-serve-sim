import { describe, expect, test } from "bun:test";
import {
  MAX_SAMPLES,
  nextAppMetricsStream,
  parseAppMetrics,
  type AppMetrics,
  type AppMetricsStream,
} from "../client/hooks/use-app-metrics";

const sample = (overrides: Partial<AppMetrics> = {}): AppMetrics => ({
  state: "live",
  bundleId: "com.example.metrics",
  pid: 4242,
  processStartId: "987654321",
  alive: true,
  sampledAtMs: 1_750_000_000_000,
  cpuPercent: 37.5,
  cpuUserPercent: 25,
  cpuSystemPercent: 12.5,
  memoryFootprintBytes: 200 * 1024 * 1024,
  residentBytes: 180 * 1024 * 1024,
  peakMemoryFootprintBytes: 240 * 1024 * 1024,
  diskReadBytesPerSecond: 8_192,
  diskWriteBytesPerSecond: 4_096,
  wakeupsPerSecond: 3,
  pageInsPerSecond: 1,
  threadCount: 12,
  runningThreadCount: 2,
  ...overrides,
});

const empty: AppMetricsStream = { latest: null, samples: [], error: null };

describe("parseAppMetrics", () => {
  test("accepts and preserves every native metric", () => {
    const metrics = sample();
    expect(parseAppMetrics(metrics)).toEqual(metrics);
  });

  test("accepts null rates while the native sampler is priming", () => {
    const metrics = sample({
      cpuPercent: null,
      cpuUserPercent: null,
      cpuSystemPercent: null,
      diskReadBytesPerSecond: null,
      diskWriteBytesPerSecond: null,
      wakeupsPerSecond: null,
      pageInsPerSecond: null,
    });
    expect(parseAppMetrics(metrics)).toEqual(metrics);
  });

  test("rejects partial or non-finite payloads instead of showing stale data", () => {
    expect(parseAppMetrics({ alive: true, pid: 42 })).toBeNull();
    expect(parseAppMetrics({ ...sample(), cpuPercent: Number.NaN })).toBeNull();
    expect(parseAppMetrics({ ...sample(), threadCount: -1 })).toBeNull();
    expect(parseAppMetrics({ ...sample(), state: "unavailable" })).toBeNull();
  });
});

describe("nextAppMetricsStream", () => {
  test("appends chart samples and retains all latest detail metrics", () => {
    const metrics = sample();
    expect(nextAppMetricsStream(empty, metrics)).toEqual({
      latest: metrics,
      samples: [
        {
          cpuPercent: metrics.cpuPercent,
          memoryFootprintBytes: metrics.memoryFootprintBytes!,
        },
      ],
      error: null,
    });
  });

  test("resets history when the authoritative app identity changes", () => {
    const first = nextAppMetricsStream(empty, sample());
    const replacement = sample({ bundleId: "com.example.relaunched", pid: 5252 });
    const next = nextAppMetricsStream(first, replacement);
    expect(next.latest).toEqual(replacement);
    expect(next.samples).toEqual([
      {
        cpuPercent: replacement.cpuPercent,
        memoryFootprintBytes: replacement.memoryFootprintBytes!,
      },
    ]);
  });

  test("resets history when a PID is reused by a new process instance", () => {
    const first = nextAppMetricsStream(empty, sample());
    const replacement = sample({ processStartId: "987654999" });
    const next = nextAppMetricsStream(first, replacement);
    expect(next.samples).toEqual([
      {
        cpuPercent: replacement.cpuPercent,
        memoryFootprintBytes: replacement.memoryFootprintBytes!,
      },
    ]);
  });

  test("clears history when no foreground app is alive", () => {
    const live = nextAppMetricsStream(empty, sample());
    const unavailable = sample({
      state: "no-foreground-app",
      bundleId: null,
      pid: null,
      processStartId: null,
      alive: false,
      cpuPercent: null,
      cpuUserPercent: null,
      cpuSystemPercent: null,
      memoryFootprintBytes: null,
      residentBytes: null,
      peakMemoryFootprintBytes: null,
      diskReadBytesPerSecond: null,
      diskWriteBytesPerSecond: null,
      wakeupsPerSecond: null,
      pageInsPerSecond: null,
      threadCount: null,
      runningThreadCount: null,
    });
    expect(nextAppMetricsStream(live, unavailable)).toEqual({
      latest: unavailable,
      samples: [],
      error: null,
    });
  });

  test("keeps only the configured history window", () => {
    let stream = empty;
    for (let index = 0; index < MAX_SAMPLES + 3; index++) {
      stream = nextAppMetricsStream(
        stream,
        sample({
          sampledAtMs: 1_750_000_000_000 + index,
          cpuPercent: index,
        }),
      );
    }
    expect(stream.samples).toHaveLength(MAX_SAMPLES);
    expect(stream.samples[0]?.cpuPercent).toBe(3);
  });
});
