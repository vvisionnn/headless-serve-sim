import { describe, expect, test } from "bun:test";
import {
  createEventLog,
  describeEvent,
  formatEventLine,
  formatEventTime,
  keyLabel,
  type EventLogEntry,
} from "../event-log";

const AT = () => new Date("2026-08-10T12:34:56.789Z");

describe("createEventLog", () => {
  test("assigns increasing ids and keeps insertion order", () => {
    const log = createEventLog();
    const a = log.append({ source: "hid", kind: "tap" });
    const b = log.append({ source: "hid", kind: "tap" });
    expect(b.id).toBeGreaterThan(a.id);
    expect(log.list().map((e) => e.id)).toEqual([a.id, b.id]);
  });

  test("stamps a timestamp from the injected clock", () => {
    const log = createEventLog();
    expect(log.append({ source: "hid", kind: "tap" }, AT).timestamp).toBe(
      "2026-08-10T12:34:56.789Z",
    );
  });

  // Input is high-rate; without a bound the server's heap grows for the life of
  // the session to back a panel showing the last few dozen rows.
  test("drops the oldest entries past the cap", () => {
    const log = createEventLog(3);
    for (let i = 0; i < 10; i++) log.append({ source: "hid", kind: `k${i}` });
    expect(log.size).toBe(3);
    expect(log.list().map((e) => e.kind)).toEqual(["k7", "k8", "k9"]);
  });

  test("ids keep increasing across eviction so `after` stays monotonic", () => {
    const log = createEventLog(2);
    for (let i = 0; i < 5; i++) log.append({ source: "hid", kind: "tap" });
    const ids = log.list().map((e) => e.id);
    expect(ids).toEqual([4, 5]);
  });

  test("list(after) returns only newer entries", () => {
    const log = createEventLog();
    const first = log.append({ source: "hid", kind: "a" });
    log.append({ source: "hid", kind: "b" });
    expect(log.list(first.id).map((e) => e.kind)).toEqual(["b"]);
  });

  test("list() returns a copy, so callers can't mutate history", () => {
    const log = createEventLog();
    log.append({ source: "hid", kind: "tap" });
    log.list().push({} as EventLogEntry);
    expect(log.size).toBe(1);
  });

  test("subscribers receive appends until they unsubscribe", () => {
    const log = createEventLog();
    const seen: string[] = [];
    const stop = log.subscribe((entry) => seen.push(entry.kind));
    log.append({ source: "hid", kind: "a" });
    stop();
    log.append({ source: "hid", kind: "b" });
    expect(seen).toEqual(["a"]);
  });

  test("clear empties the buffer", () => {
    const log = createEventLog();
    log.append({ source: "hid", kind: "tap" });
    log.clear();
    expect(log.list()).toEqual([]);
  });

  test("derives msg when the reporter doesn't supply one", () => {
    const log = createEventLog();
    const entry = log.append({ source: "hid", kind: "tap", details: { x: 0.5, y: 0.25 } });
    expect(entry.msg).toBe("Tap (0.500, 0.250)");
  });

  test("an explicit msg wins over the derived one", () => {
    const log = createEventLog();
    expect(log.append({ source: "ui", kind: "tap", msg: "custom" }).msg).toBe("custom");
  });

  test("a blank msg falls back to the derived one", () => {
    const log = createEventLog();
    expect(log.append({ source: "ui", kind: "home", msg: "   " }).msg).toBe("Home");
  });
});

describe("keyLabel", () => {
  test("maps letters, digits and function keys", () => {
    expect(keyLabel(0x04)).toBe("A");
    expect(keyLabel(0x1d)).toBe("Z");
    expect(keyLabel(0x1e)).toBe("1");
    expect(keyLabel(0x27)).toBe("0");
    expect(keyLabel(0x3a)).toBe("F1");
    expect(keyLabel(0x45)).toBe("F12");
  });

  test("names non-printing keys", () => {
    expect(keyLabel(0x28)).toBe("Enter");
    expect(keyLabel(0x2c)).toBe("Space");
    expect(keyLabel(0xe3)).toBe("Command");
  });

  test("falls back to hex for an unmapped usage", () => {
    expect(keyLabel(0xfe)).toBe("0xfe");
  });
});

describe("describeEvent", () => {
  test("describes each supported kind", () => {
    expect(describeEvent({ kind: "tap", details: { x: 0.1, y: 0.2 } })).toBe("Tap (0.100, 0.200)");
    expect(describeEvent({ kind: "button", details: { button: "home" } })).toBe("Button home");
    expect(describeEvent({ kind: "key", details: { type: "down", usage: 0x28 } })).toBe(
      "Key down Enter",
    );
    expect(describeEvent({ kind: "software-keyboard" })).toBe("Toggle software keyboard");
  });

  test("includes the travelled distance for a drag", () => {
    const msg = describeEvent({
      kind: "drag",
      details: { fromX: 0.1, fromY: 0.1, toX: 0.9, toY: 0.9, distance: 1.131 },
    });
    expect(msg).toContain("(0.100, 0.100)");
    expect(msg).toContain("(0.900, 0.900)");
    expect(msg).toContain("1.131");
  });

  // The describer runs on data reported by the page, so it has to be total:
  // a missing field must not produce "undefined" or throw.
  test("is total for missing or unknown details", () => {
    expect(describeEvent({ kind: "tap" })).toBe("Tap (?, ?)");
    expect(describeEvent({ kind: "key", details: {} })).toBe("Key ?");
    expect(describeEvent({ kind: "totally-unknown" })).toBe("totally-unknown");
  });

  test("does not emit NaN for a non-finite coordinate", () => {
    expect(describeEvent({ kind: "tap", details: { x: Number.NaN, y: 1 } })).toBe("Tap (?, 1.000)");
  });
});

describe("formatEventLine", () => {
  test("renders time, source/kind and message", () => {
    const entry: EventLogEntry = {
      id: 1,
      timestamp: "2026-08-10T12:34:56.789Z",
      source: "hid",
      kind: "tap",
      msg: "Tap (0.500, 0.500)",
    };
    const line = formatEventLine(entry);
    expect(line).toContain("hid/tap");
    expect(line).toContain("Tap (0.500, 0.500)");
    expect(line.startsWith(formatEventTime(entry.timestamp))).toBe(true);
  });

  test("marks errors", () => {
    const line = formatEventLine({
      id: 1,
      timestamp: "2026-08-10T12:34:56.789Z",
      source: "exec",
      kind: "tap",
      msg: "failed",
      status: "error",
    });
    expect(line).toContain("ERROR");
  });

  test("prefers an explicit device label over the udid", () => {
    const entry: EventLogEntry = {
      id: 1,
      timestamp: "2026-08-10T12:34:56.789Z",
      source: "hid",
      kind: "tap",
      msg: "Tap",
      device: "UDID-1",
    };
    expect(formatEventLine(entry)).toContain("[UDID-1]");
    expect(formatEventLine(entry, "iPhone 16 Pro")).toContain("[iPhone 16 Pro]");
  });
});

describe("formatEventTime", () => {
  test("pads to a fixed width so columns line up", () => {
    expect(formatEventTime("2026-08-10T00:00:00.001Z")).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  test("passes through an unparseable timestamp instead of printing NaN", () => {
    expect(formatEventTime("not a date")).toBe("not a date");
  });
});
