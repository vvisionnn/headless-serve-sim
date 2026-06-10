import { useCallback, useEffect, useState } from "react";
import type { ConnectionStats } from "headless-serve-sim-client/simulator";

// ~1 min of history at the 1 Hz emit cadence — enough for a legible trace
// without unbounded growth.
const STATS_HISTORY = 60;

interface MetricHistory {
  fps: number[];
  bitrateBps: number[];
  jitterMs: number[];
  decodeMs: number[];
}

const EMPTY_HISTORY: MetricHistory = { fps: [], bitrateBps: [], jitterMs: [], decodeMs: [] };

export interface ConnectionStatsStream {
  latest: ConnectionStats | null;
  history: MetricHistory;
  /** Wire this to SimulatorView's `onConnectionStats`. Stable identity. */
  record: (snap: ConnectionStats) => void;
}

function push(series: number[], value: number): number[] {
  const next = series.length >= STATS_HISTORY ? series.slice(1) : series.slice();
  next.push(value);
  return next;
}

/**
 * Holds the latest Connection Stats snapshot plus bounded per-metric history for
 * the sparklines. Resets whenever `enabled` flips off so a reopened panel never
 * shows a stale trace. The producer (SimulatorView) only emits while enabled, so
 * `record` is otherwise dormant.
 */
export function useConnectionStats(enabled: boolean): ConnectionStatsStream {
  const [latest, setLatest] = useState<ConnectionStats | null>(null);
  const [history, setHistory] = useState<MetricHistory>(EMPTY_HISTORY);

  useEffect(() => {
    if (!enabled) {
      setLatest(null);
      setHistory(EMPTY_HISTORY);
    }
  }, [enabled]);

  const record = useCallback((snap: ConnectionStats) => {
    setLatest(snap);
    setHistory((prev) => ({
      fps: push(prev.fps, snap.fps),
      bitrateBps: push(prev.bitrateBps, snap.bitrateBps),
      jitterMs: push(prev.jitterMs, snap.jitterMs),
      // `null` means "no measurable decode this tick" — skip it rather than
      // logging a phantom 0ms that would drag the card's min/avg until it ages out.
      decodeMs: snap.decodeMs != null ? push(prev.decodeMs, snap.decodeMs) : prev.decodeMs,
    }));
  }, []);

  return { latest, history, record };
}
