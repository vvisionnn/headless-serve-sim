/**
 * Ring buffer of simulator input events, plus the pure helpers for describing
 * them.
 *
 * Input in this fork travels from the browser straight to the Swift helper's
 * WebSocket — the preview server never sees it. So events are reported to the
 * server rather than observed by it, and the server owns the buffer so the CLI
 * (`headless-serve-sim events`) and the in-page panel read the same history
 * instead of each keeping their own.
 */

export type EventLogSource = "hid" | "exec" | "ui";
export type EventLogStatus = "ok" | "error";

export interface EventLogEntry {
  id: number;
  /** ISO-8601, assigned by the server so entries share one clock. */
  timestamp: string;
  source: EventLogSource;
  kind: string;
  /** Human-readable one-liner, used by both the CLI and the panel. */
  msg: string;
  device?: string;
  status?: EventLogStatus;
  details?: Record<string, unknown>;
}

/** What a reporter sends; the server assigns id/timestamp/msg. */
export interface EventLogDraft {
  source: EventLogSource;
  kind: string;
  device?: string;
  status?: EventLogStatus;
  msg?: string;
  details?: Record<string, unknown>;
}

/**
 * Entries retained. Input is high-rate, so this is a bounded window, not a
 * transcript — old entries fall off rather than growing the server's heap for
 * a panel showing the most recent few dozen.
 */
export const EVENT_LOG_MAX_ENTRIES = 500;

export interface EventLog {
  append(draft: EventLogDraft, now?: () => Date): EventLogEntry;
  /** Oldest first. */
  list(afterId?: number): EventLogEntry[];
  subscribe(listener: (entry: EventLogEntry) => void): () => void;
  clear(): void;
  readonly size: number;
}

export function createEventLog(max: number = EVENT_LOG_MAX_ENTRIES): EventLog {
  const entries: EventLogEntry[] = [];
  const listeners = new Set<(entry: EventLogEntry) => void>();
  let nextId = 1;

  return {
    append(draft, now = () => new Date()) {
      const entry: EventLogEntry = {
        id: nextId++,
        timestamp: now().toISOString(),
        source: draft.source,
        kind: draft.kind,
        msg: draft.msg?.trim() || describeEvent(draft),
        ...(draft.device ? { device: draft.device } : {}),
        ...(draft.status ? { status: draft.status } : {}),
        ...(draft.details ? { details: draft.details } : {}),
      };
      entries.push(entry);
      // Drop from the front rather than slicing a copy: this runs per event.
      while (entries.length > max) entries.shift();
      for (const listener of listeners) listener(entry);
      return entry;
    },
    list(afterId) {
      if (afterId === undefined) return [...entries];
      return entries.filter((entry) => entry.id > afterId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      entries.length = 0;
    },
    get size() {
      return entries.length;
    },
  };
}

// ─── Humanizing ───

/** USB HID keyboard usages whose label isn't just the character. */
const KEY_LABEL_BY_USAGE: Record<number, string> = {
  0x28: "Enter",
  0x29: "Escape",
  0x2a: "Backspace",
  0x2b: "Tab",
  0x2c: "Space",
  0x39: "CapsLock",
  0x4a: "Home",
  0x4b: "PageUp",
  0x4c: "Delete",
  0x4d: "End",
  0x4e: "PageDown",
  0x4f: "ArrowRight",
  0x50: "ArrowLeft",
  0x51: "ArrowDown",
  0x52: "ArrowUp",
  0xe0: "Control",
  0xe1: "Shift",
  0xe2: "Option",
  0xe3: "Command",
  0xe4: "Control",
  0xe5: "Shift",
  0xe6: "Option",
  0xe7: "Command",
};

/** Label for a USB HID keyboard usage (page 0x07). */
export function keyLabel(usage: number): string {
  const named = KEY_LABEL_BY_USAGE[usage];
  if (named) return named;
  if (usage >= 0x04 && usage <= 0x1d) return String.fromCharCode(65 + (usage - 0x04)); // A–Z
  if (usage >= 0x1e && usage <= 0x26) return String.fromCharCode(49 + (usage - 0x1e)); // 1–9
  if (usage === 0x27) return "0";
  if (usage >= 0x3a && usage <= 0x45) return `F${usage - 0x39}`; // F1–F12
  return `0x${usage.toString(16)}`;
}

/** Normalized 0–1 coordinate, fixed to 3 places so columns line up. */
function coord(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "?";
}

function point(details: Record<string, unknown> | undefined, xKey = "x", yKey = "y"): string {
  return `(${coord(details?.[xKey])}, ${coord(details?.[yKey])})`;
}

/**
 * One-line description of an event. Pure, and total — an unrecognized kind
 * still produces something readable rather than blank.
 */
export function describeEvent(draft: Pick<EventLogDraft, "kind" | "details">): string {
  const d = draft.details;
  switch (draft.kind) {
    case "tap":
      return `Tap ${point(d)}`;
    case "drag": {
      const distance =
        typeof d?.distance === "number" ? ` · ${(d.distance as number).toFixed(3)}` : "";
      return `Drag ${point(d, "fromX", "fromY")} → ${point(d, "toX", "toY")}${distance}`;
    }
    case "touch":
      return `Touch ${String(d?.type ?? "?")} ${point(d)}`;
    case "multi-touch":
      return `Pinch ${point(d, "x1", "y1")} ${point(d, "x2", "y2")}`;
    case "key": {
      const usage = typeof d?.usage === "number" ? keyLabel(d.usage) : "?";
      return `Key ${String(d?.type ?? "")} ${usage}`.replace(/\s+/g, " ").trim();
    }
    case "text":
      return `Type ${JSON.stringify(String(d?.text ?? ""))}`;
    case "button":
      return `Button ${String(d?.button ?? "?")}`;
    case "scroll":
      return `Scroll ${point(d, "dx", "dy")} at ${point(d)}`;
    case "rotate":
      return `Rotate ${String(d?.orientation ?? "?")}`;
    case "software-keyboard":
      return "Toggle software keyboard";
    case "home":
      return "Home";
    default:
      return draft.kind;
  }
}

/** `HH:MM:SS.mmm` in local time — the CLI's leading column. */
export function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

/** One CLI line for an entry. */
export function formatEventLine(entry: EventLogEntry, deviceName?: string): string {
  const label = deviceName ?? entry.device;
  const device = label ? ` [${label}]` : "";
  const status = entry.status === "error" ? " ERROR" : "";
  return `${formatEventTime(entry.timestamp)}${device} ${entry.source}/${entry.kind}${status} ${entry.msg}`;
}
