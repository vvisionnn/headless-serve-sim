import type { SimLogLevel } from "../../sim-log-stream";

export interface SimLogEntry {
  id: string;
  timestamp: string;
  process: string;
  processId: number | null;
  subsystem: string;
  category: string;
  level: string;
  message: string;
  byteSize: number;
}

export interface SimLogBuffer {
  entries: SimLogEntry[];
  totalBytes: number;
}

export interface SimLogBufferLimits {
  maxEntries: number;
  maxBytes: number;
}

export interface SimLogFilter {
  search: string;
  process: string;
  appProcessId: number | null;
  includeSystem: boolean;
}

const utf8 = new TextEncoder();

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? "";
}

export function normalizeSimLogEntry(value: unknown, id: string): SimLogEntry | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const message = stringField(raw.eventMessage);
  if (message.length === 0) return null;

  const timestamp = stringField(raw.timestamp);
  const process = basename(stringField(raw.processImagePath) || stringField(raw.senderImagePath));
  const processId =
    typeof raw.processID === "number" && Number.isSafeInteger(raw.processID) && raw.processID >= 0
      ? raw.processID
      : null;
  const subsystem = stringField(raw.subsystem);
  const category = stringField(raw.category);
  const level = stringField(raw.messageType).toLowerCase() || "default";
  const byteSize = utf8.encode(
    [timestamp, process, processId, subsystem, category, level, message].join("\0"),
  ).byteLength;

  return {
    id,
    timestamp,
    process,
    processId,
    subsystem,
    category,
    level,
    message,
    byteSize,
  };
}

export function appendSimLogs(
  current: SimLogBuffer,
  incoming: readonly SimLogEntry[],
  limits: SimLogBufferLimits,
): SimLogBuffer {
  if (incoming.length === 0) return current;
  const entries = [...current.entries];
  let totalBytes = current.totalBytes;

  for (const entry of incoming) {
    if (entry.byteSize > limits.maxBytes) continue;
    entries.push(entry);
    totalBytes += entry.byteSize;
  }

  let removeCount = 0;
  while (entries.length - removeCount > limits.maxEntries || totalBytes > limits.maxBytes) {
    totalBytes -= entries[removeCount]!.byteSize;
    removeCount++;
  }

  return {
    entries: removeCount === 0 ? entries : entries.slice(removeCount),
    totalBytes,
  };
}

export function filterSimLogs(
  entries: readonly SimLogEntry[],
  filter: SimLogFilter,
): SimLogEntry[] {
  const search = filter.search.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (
      !filter.includeSystem &&
      (filter.appProcessId === null || entry.processId !== filter.appProcessId)
    )
      return false;
    if (filter.process && entry.process !== filter.process) return false;
    if (!search) return true;
    return [entry.message, entry.process, entry.subsystem, entry.category].some((field) =>
      field.toLocaleLowerCase().includes(search),
    );
  });
}

export function simLogProcesses(entries: readonly SimLogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.process).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function buildSimLogsUrl(
  endpoint: string,
  options: { level: SimLogLevel; processId: number | null },
  baseUrl = window.location.href,
): string {
  const url = new URL(endpoint, baseUrl);
  url.searchParams.set("level", options.level);
  if (options.processId === null) url.searchParams.delete("processId");
  else url.searchParams.set("processId", String(options.processId));
  return url.toString();
}
