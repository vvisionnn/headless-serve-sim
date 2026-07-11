import type { SimLogLevel } from "../../sim-log-stream";
import { buildSimLogsUrl, normalizeSimLogEntry, type SimLogEntry } from "./sim-logs";

export type SimLogFeedStatus = "connecting" | "live" | "reconnecting";

interface SimLogEventSource {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export interface CreateSimLogFeedOptions {
  endpoint: string;
  level: SimLogLevel;
  onStatus: (status: SimLogFeedStatus) => void;
  onBatch: (entries: SimLogEntry[]) => void;
  baseUrl?: string;
  idPrefix?: string;
  eventSourceFactory?: (url: string) => SimLogEventSource;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  maxPendingEntries?: number;
  maxPendingBytes?: number;
}

export interface SimLogFeed {
  stop(): void;
}

let feedSequence = 0;

export function createSimLogFeed({
  endpoint,
  level,
  onStatus,
  onBatch,
  baseUrl,
  idPrefix,
  eventSourceFactory = (url) => new EventSource(url),
  scheduleFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  maxPendingEntries = 2_000,
  maxPendingBytes = 2 * 1024 * 1024,
}: CreateSimLogFeedOptions): SimLogFeed {
  feedSequence += 1;
  const resolvedIdPrefix = idPrefix ?? `sim-log-feed-${feedSequence}`;
  let active = true;
  let nextEntry = 0;
  let frameId: number | null = null;
  let pending: SimLogEntry[] = [];
  let pendingBytes = 0;

  onStatus("connecting");
  const source = eventSourceFactory(buildSimLogsUrl(endpoint, level, baseUrl));

  const flush = () => {
    frameId = null;
    if (!active || pending.length === 0) return;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    onBatch(batch);
  };

  source.onopen = () => {
    if (active) onStatus("live");
  };
  source.onerror = () => {
    if (active) onStatus("reconnecting");
  };
  source.onmessage = (event) => {
    if (!active) return;
    try {
      const entry = normalizeSimLogEntry(
        JSON.parse(event.data) as unknown,
        `${resolvedIdPrefix}-${++nextEntry}`,
      );
      if (!entry) return;
      if (entry.byteSize > maxPendingBytes) return;
      pending.push(entry);
      pendingBytes += entry.byteSize;
      while (
        pending.length > maxPendingEntries ||
        pendingBytes > maxPendingBytes
      ) {
        pendingBytes -= pending.shift()!.byteSize;
      }
      if (frameId == null) frameId = scheduleFrame(flush);
    } catch {}
  };

  return {
    stop() {
      if (!active) return;
      active = false;
      source.onopen = null;
      source.onmessage = null;
      source.onerror = null;
      source.close();
      if (frameId != null) cancelFrame(frameId);
      frameId = null;
      pending = [];
      pendingBytes = 0;
    },
  };
}

const PROCESS_COLORS = [
  "#007aff",
  "#198754",
  "#b35c00",
  "#af52de",
  "#d10f6a",
  "#087f8c",
] as const;

function processColor(process: string): string {
  let hash = 0;
  for (let index = 0; index < process.length; index++) {
    hash = ((hash << 5) - hash + process.charCodeAt(index)) | 0;
  }
  return PROCESS_COLORS[Math.abs(hash) % PROCESS_COLORS.length]!;
}

export function forwardSimLogToConsole(
  entry: SimLogEntry,
  target: Pick<Console, "log"> = console,
): void {
  const process = entry.process || "Simulator";
  const source = [entry.subsystem, entry.category].filter(Boolean).join(":");
  const label = source ? `${process} ${source}` : process;
  const messageColor = entry.level === "error" || entry.level === "fault"
    ? "#ff3b30"
    : entry.level === "debug"
      ? "#6c6c70"
      : "inherit";
  target.log(
    "%c%s%c %c%s",
    `color:${processColor(process)};font-weight:600`,
    label,
    "color:inherit;font-weight:normal",
    `color:${messageColor}`,
    entry.message,
  );
}
