import { useEffect, useState } from "react";

export interface AppMetrics {
  state: "live" | "no-foreground-app" | "unavailable";
  bundleId: string | null;
  pid: number | null;
  processStartId: string | null;
  alive: boolean;
  sampledAtMs: number;
  cpuPercent: number | null;
  cpuUserPercent: number | null;
  cpuSystemPercent: number | null;
  memoryFootprintBytes: number | null;
  residentBytes: number | null;
  peakMemoryFootprintBytes: number | null;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
  wakeupsPerSecond: number | null;
  pageInsPerSecond: number | null;
  threadCount: number | null;
  runningThreadCount: number | null;
}

export interface MetricSample {
  cpuPercent: number | null;
  memoryFootprintBytes: number;
}

export interface AppMetricsStream {
  latest: AppMetrics | null;
  samples: MetricSample[];
  error: string | null;
}

export const MAX_SAMPLES = 48;
const POLL_INTERVAL_MS = 1_000;
const EMPTY_STREAM: AppMetricsStream = { latest: null, samples: [], error: null };

const NULLABLE_NUMBER_FIELDS = [
  "cpuPercent",
  "cpuUserPercent",
  "cpuSystemPercent",
  "memoryFootprintBytes",
  "residentBytes",
  "peakMemoryFootprintBytes",
  "diskReadBytesPerSecond",
  "diskWriteBytesPerSecond",
  "wakeupsPerSecond",
  "pageInsPerSecond",
  "threadCount",
  "runningThreadCount",
] as const;

export function parseAppMetrics(raw: unknown): AppMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const state = value.state === "live" || value.state === "no-foreground-app" ||
    value.state === "unavailable" ? value.state : null;
  if (!state) return null;
  if (typeof value.alive !== "boolean") return null;
  if (value.alive !== (state === "live")) return null;
  if (typeof value.sampledAtMs !== "number" || !Number.isFinite(value.sampledAtMs)) return null;

  const bundleId = value.bundleId === null || typeof value.bundleId === "string"
    ? value.bundleId
    : undefined;
  const pid = value.pid === null || (
    typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0
  ) ? value.pid : undefined;
  const processStartId = value.processStartId === null || (
    typeof value.processStartId === "string" && /^\d+$/.test(value.processStartId)
  ) ? value.processStartId : undefined;
  if (bundleId === undefined || pid === undefined || processStartId === undefined) return null;
  if (state === "live" && (!bundleId || pid === null || processStartId === null)) return null;
  if (state === "no-foreground-app" && (
    bundleId !== null || pid !== null || processStartId !== null
  )) return null;
  if (state === "unavailable" && processStartId !== null) return null;

  const numbers: Partial<Record<(typeof NULLABLE_NUMBER_FIELDS)[number], number | null>> = {};
  for (const field of NULLABLE_NUMBER_FIELDS) {
    const item = value[field];
    if (item === null) {
      numbers[field] = null;
    } else if (typeof item === "number" && Number.isFinite(item) && item >= 0) {
      numbers[field] = item;
    } else {
      return null;
    }
  }

  const threadCount = numbers.threadCount!;
  const runningThreadCount = numbers.runningThreadCount!;
  if ((threadCount !== null && !Number.isInteger(threadCount)) ||
      (runningThreadCount !== null && !Number.isInteger(runningThreadCount))) return null;
  if (threadCount !== null && runningThreadCount !== null && runningThreadCount > threadCount) return null;

  const memoryFootprintBytes = numbers.memoryFootprintBytes!;
  const residentBytes = numbers.residentBytes!;
  const peakMemoryFootprintBytes = numbers.peakMemoryFootprintBytes!;
  if (value.alive && (
    memoryFootprintBytes === null || residentBytes === null ||
    peakMemoryFootprintBytes === null || threadCount === null || runningThreadCount === null
  )) return null;
  if (memoryFootprintBytes !== null && peakMemoryFootprintBytes !== null &&
      peakMemoryFootprintBytes < memoryFootprintBytes) return null;
  if (!value.alive && NULLABLE_NUMBER_FIELDS.some((field) => numbers[field] !== null)) return null;

  return {
    state,
    bundleId,
    pid,
    processStartId,
    alive: value.alive,
    sampledAtMs: value.sampledAtMs,
    cpuPercent: numbers.cpuPercent!,
    cpuUserPercent: numbers.cpuUserPercent!,
    cpuSystemPercent: numbers.cpuSystemPercent!,
    memoryFootprintBytes,
    residentBytes,
    peakMemoryFootprintBytes,
    diskReadBytesPerSecond: numbers.diskReadBytesPerSecond!,
    diskWriteBytesPerSecond: numbers.diskWriteBytesPerSecond!,
    wakeupsPerSecond: numbers.wakeupsPerSecond!,
    pageInsPerSecond: numbers.pageInsPerSecond!,
    threadCount,
    runningThreadCount,
  };
}

export function nextAppMetricsStream(
  previous: AppMetricsStream,
  metrics: AppMetrics,
): AppMetricsStream {
  if (!metrics.alive || metrics.memoryFootprintBytes === null) {
    return { latest: metrics, samples: [], error: null };
  }

  const sameProcess = previous.latest?.alive === true &&
    previous.latest.bundleId === metrics.bundleId &&
    previous.latest.pid === metrics.pid &&
    previous.latest.processStartId === metrics.processStartId;
  const samples = sameProcess ? previous.samples : [];
  const nextSample: MetricSample = {
    cpuPercent: metrics.cpuPercent,
    memoryFootprintBytes: metrics.memoryFootprintBytes,
  };
  return {
    latest: metrics,
    samples: [...samples, nextSample].slice(-MAX_SAMPLES),
    error: null,
  };
}

// Poll the simulator-bound helper's native foreground-app metrics and retain a
// bounded history for the two charted values. Every failed or invalid response
// clears the live reading so stale numbers are never presented as current.
export function useAppMetrics(
  endpoint: string | undefined,
  enabled: boolean,
): AppMetricsStream {
  const [stream, setStream] = useState<AppMetricsStream>(EMPTY_STREAM);

  useEffect(() => {
    if (!enabled || !endpoint) {
      setStream(EMPTY_STREAM);
      return;
    }

    setStream(EMPTY_STREAM);
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error(`metrics HTTP ${response.status}`);
        const metrics = parseAppMetrics(await response.json());
        if (!metrics) throw new Error("invalid metrics payload");
        if (!cancelled) setStream((previous) => nextAppMetricsStream(previous, metrics));
      } catch {
        if (!cancelled) {
          setStream({ latest: null, samples: [], error: "Metrics unavailable" });
        }
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [endpoint, enabled]);

  return stream;
}
