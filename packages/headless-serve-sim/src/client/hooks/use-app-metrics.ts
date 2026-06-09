import { useEffect, useState } from "react";
import { simEndpoint } from "../utils/sim-endpoint";

export interface AppMetrics {
  pid: number;
  alive: boolean;
  rssBytes: number | null;
  cpuPercent: number | null;
}

export interface MetricSample {
  cpuPercent: number | null;
  rssBytes: number;
}

export interface AppMetricsStream {
  latest: AppMetrics | null;
  samples: MetricSample[];
}

export const MAX_SAMPLES = 48;

// Poll the foreground app's live CPU/memory at ~1Hz and accumulate a bounded
// rolling history for the charts. Mirrors use-grid-memory; the server keeps the
// per-PID CPU-time history, so each tick is one cheap `ps`.
export function useAppMetrics(pid: number | undefined, enabled: boolean): AppMetricsStream {
  const [stream, setStream] = useState<AppMetricsStream>({ latest: null, samples: [] });
  useEffect(() => {
    if (!enabled || !pid) {
      setStream({ latest: null, samples: [] });
      return;
    }
    // Reset between apps so a previous PID's trace never bleeds in.
    setStream({ latest: null, samples: [] });
    let cancelled = false;
    const endpoint = simEndpoint("api/metrics");
    const tick = async () => {
      try {
        const res = await fetch(`${endpoint}?pid=${pid}`, { cache: "no-store" });
        const json = (await res.json()) as AppMetrics;
        if (cancelled) return;
        setStream((prev) => {
          if (!json.alive) return { latest: json, samples: prev.samples };
          const sample: MetricSample = {
            cpuPercent: json.cpuPercent,
            rssBytes: json.rssBytes ?? 0,
          };
          return { latest: json, samples: [...prev.samples, sample].slice(-MAX_SAMPLES) };
        });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pid, enabled]);
  return stream;
}
