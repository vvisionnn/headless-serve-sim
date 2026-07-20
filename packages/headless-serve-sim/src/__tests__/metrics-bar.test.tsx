import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricsDashboard } from "../client/components/metrics-bar";
import type { AppMetricsStream } from "../client/hooks/use-app-metrics";

const liveStream: AppMetricsStream = {
  latest: {
    state: "live",
    bundleId: "com.example.metrics",
    pid: 4242,
    processStartId: "987654321",
    alive: true,
    sampledAtMs: Date.UTC(2026, 6, 10, 15, 30, 0),
    cpuPercent: 37.5,
    cpuUserPercent: 25,
    cpuSystemPercent: 12.5,
    memoryFootprintBytes: 200 * 1024 * 1024,
    residentBytes: 180 * 1024 * 1024,
    peakMemoryFootprintBytes: 240 * 1024 * 1024,
    diskReadBytesPerSecond: 8 * 1024,
    diskWriteBytesPerSecond: 4 * 1024,
    wakeupsPerSecond: 3,
    pageInsPerSecond: 1,
    threadCount: 12,
    runningThreadCount: 2,
  },
  samples: [
    { cpuPercent: null, memoryFootprintBytes: 198 * 1024 * 1024 },
    { cpuPercent: 37.5, memoryFootprintBytes: 200 * 1024 * 1024 },
  ],
  error: null,
};

describe("MetricsDashboard", () => {
  test("renders every native app metric with truthful labels and units", () => {
    const html = renderToStaticMarkup(<MetricsDashboard stream={liveStream} />);

    for (const text of [
      "com.example.metrics",
      "PID 4242",
      "Live",
      "CPU",
      "37.5",
      "Memory Footprint",
      "200",
      "User CPU",
      "25.0%",
      "System CPU",
      "12.5%",
      "Peak Footprint",
      "240 MB",
      "Resident Memory",
      "180 MB",
      "Threads",
      "12",
      "Running",
      "2",
      "Disk Read",
      "8.0 KB/s",
      "Disk Write",
      "4.0 KB/s",
      "Wakeups",
      "3.0/s",
      "Page-ins",
      "1.0/s",
      "Updated",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("2026-07-10T15:30:00.000Z");
  });

  test("shows an explicit unavailable state without stale metric values", () => {
    const html = renderToStaticMarkup(
      <MetricsDashboard stream={{ latest: null, samples: [], error: "Metrics unavailable" }} />,
    );
    expect(html).toContain("Metrics unavailable");
    expect(html).not.toContain("com.example.metrics");
    expect(html).not.toContain("37.5");
  });

  test("keeps polling timestamps out of the live status announcement", () => {
    const renderAt = (sampledAtMs: number) =>
      renderToStaticMarkup(
        <MetricsDashboard
          stream={{
            ...liveStream,
            latest: { ...liveStream.latest!, sampledAtMs },
          }}
        />,
      );
    const liveRegion = (html: string) =>
      html.match(
        /<(div|section)[^>]*(?:aria-live="(?:polite|assertive)"|role="(?:status|alert|log)")[^>]*>[\s\S]*?<\/\1>/,
      )?.[0];

    const first = liveRegion(renderAt(Date.UTC(2026, 6, 10, 15, 30, 0)));
    const second = liveRegion(renderAt(Date.UTC(2026, 6, 10, 15, 30, 1)));

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(first).toContain("com.example.metrics");
    expect(first).toContain("Live");
    expect(first).not.toContain("Updated");
    expect(first).not.toContain("<time");
  });

  test("distinguishes no foreground app from a metrics failure", () => {
    const noForeground = renderToStaticMarkup(
      <MetricsDashboard
        stream={{
          latest: {
            ...liveStream.latest!,
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
          },
          samples: [],
          error: null,
        }}
      />,
    );
    expect(noForeground).toContain("No foreground app");
    expect(noForeground).toContain("Waiting");

    const failed = renderToStaticMarkup(
      <MetricsDashboard
        stream={{
          latest: {
            ...liveStream.latest!,
            state: "unavailable",
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
          },
          samples: [],
          error: null,
        }}
      />,
    );
    expect(failed).toContain("Metrics unavailable");
    expect(failed).toContain("Unavailable");
    expect(failed).not.toContain("No foreground app");
  });
});
