import { useCallback, useEffect, useState } from "react";
import type { SimLogLevel } from "../../sim-log-stream";
import {
  createSimLogFeed,
  forwardSimLogToConsole,
  type SimLogFeedStatus,
} from "../utils/sim-log-feed";
import {
  appendSimLogs,
  type SimLogBuffer,
  type SimLogEntry,
} from "../utils/sim-logs";

const EMPTY_BUFFER: SimLogBuffer = { entries: [], totalBytes: 0 };
const LOG_BUFFER_LIMITS = {
  maxEntries: 2_000,
  maxBytes: 2 * 1024 * 1024,
} as const;

export type SimLogsStatus = SimLogFeedStatus | "paused" | "unavailable";

export interface UseSimLogsResult {
  entries: SimLogEntry[];
  totalBytes: number;
  status: SimLogsStatus;
  level: SimLogLevel;
  paused: boolean;
  setLevel: (level: SimLogLevel) => void;
  setPaused: (paused: boolean | ((current: boolean) => boolean)) => void;
  clear: () => void;
}

export function useSimLogs(endpoint?: string): UseSimLogsResult {
  const [buffer, setBuffer] = useState<SimLogBuffer>(EMPTY_BUFFER);
  const [status, setStatus] = useState<SimLogsStatus>(endpoint ? "connecting" : "unavailable");
  const [level, setLevel] = useState<SimLogLevel>("info");
  const [paused, setPaused] = useState(false);

  const clear = useCallback(() => setBuffer(EMPTY_BUFFER), []);

  useEffect(() => {
    setBuffer(EMPTY_BUFFER);
  }, [endpoint]);

  useEffect(() => {
    if (!endpoint) {
      setStatus("unavailable");
      return;
    }
    if (paused) {
      setStatus("paused");
      return;
    }

    const feed = createSimLogFeed({
      endpoint,
      level,
      onStatus: setStatus,
      onBatch: (entries) => {
        for (const entry of entries) forwardSimLogToConsole(entry);
        setBuffer((current) => appendSimLogs(current, entries, LOG_BUFFER_LIMITS));
      },
    });
    return () => feed.stop();
  }, [endpoint, level, paused]);

  return {
    entries: buffer.entries,
    totalBytes: buffer.totalBytes,
    status,
    level,
    paused,
    setLevel,
    setPaused,
    clear,
  };
}
