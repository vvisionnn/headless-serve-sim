import { describe, expect, test } from "bun:test";
import {
  appendSimLogs,
  buildSimLogsUrl,
  filterSimLogs,
  normalizeSimLogEntry,
  simLogProcesses,
} from "../client/utils/sim-logs";

describe("normalizeSimLogEntry", () => {
  test("normalizes the useful fields from simctl NDJSON", () => {
    expect(
      normalizeSimLogEntry(
        {
          timestamp: "2026-07-11 09:41:00.123456+0800",
          processImagePath: "/Applications/My App.app/My App",
          senderImagePath: "/usr/lib/fallback",
          processID: 4242,
          subsystem: "com.example.app",
          category: "network",
          messageType: "Error",
          eventMessage: "request failed",
        },
        "log-1",
      ),
    ).toEqual({
      id: "log-1",
      timestamp: "2026-07-11 09:41:00.123456+0800",
      process: "My App",
      processId: 4242,
      subsystem: "com.example.app",
      category: "network",
      level: "error",
      message: "request failed",
      byteSize: 88,
    });
  });

  test("uses the sender fallback and rejects malformed or empty messages", () => {
    expect(
      normalizeSimLogEntry({ senderImagePath: "/usr/lib/logd", eventMessage: "ready" }, "2")
        ?.process,
    ).toBe("logd");
    expect(normalizeSimLogEntry({ eventMessage: "" }, "3")).toBeNull();
    expect(normalizeSimLogEntry({ eventMessage: 123 }, "4")).toBeNull();
    expect(normalizeSimLogEntry(null, "5")).toBeNull();
  });
});

describe("appendSimLogs", () => {
  const entry = (id: string, byteSize: number) => ({
    id,
    timestamp: "",
    process: "App",
    processId: 1,
    subsystem: "",
    category: "",
    level: "default",
    message: id,
    byteSize,
  });

  test("evicts oldest rows to satisfy both row and byte limits", () => {
    const initial = { entries: [entry("a", 4), entry("b", 4)], totalBytes: 8 };
    expect(
      appendSimLogs(initial, [entry("c", 4), entry("d", 4)], {
        maxEntries: 3,
        maxBytes: 10,
      }),
    ).toEqual({
      entries: [entry("c", 4), entry("d", 4)],
      totalBytes: 8,
    });
  });

  test("drops a single row larger than the entire buffer", () => {
    expect(
      appendSimLogs({ entries: [], totalBytes: 0 }, [entry("huge", 11)], {
        maxEntries: 10,
        maxBytes: 10,
      }),
    ).toEqual({ entries: [], totalBytes: 0 });
  });
});

describe("log filtering", () => {
  const rows = [
    normalizeSimLogEntry(
      {
        eventMessage: "Network READY [42]",
        processID: 101,
        processImagePath: "/a/Alpha",
        subsystem: "com.example",
        category: "HTTP",
      },
      "1",
    )!,
    normalizeSimLogEntry(
      {
        eventMessage: "literal .* value",
        processID: 202,
        processImagePath: "/b/Beta",
        subsystem: "system",
        category: "db",
      },
      "2",
    )!,
  ];

  test("searches message, process, subsystem, and category literally and case-insensitively", () => {
    expect(
      filterSimLogs(rows, {
        search: "ready [42]",
        process: "",
        appProcessId: null,
        includeSystem: true,
      }).map((row) => row.id),
    ).toEqual(["1"]);
    expect(
      filterSimLogs(rows, {
        search: ".*",
        process: "",
        appProcessId: null,
        includeSystem: true,
      }).map((row) => row.id),
    ).toEqual(["2"]);
    expect(
      filterSimLogs(rows, {
        search: "HTTP",
        process: "",
        appProcessId: null,
        includeSystem: true,
      }).map((row) => row.id),
    ).toEqual(["1"]);
  });

  test("applies an exact process filter and returns sorted process choices", () => {
    expect(
      filterSimLogs(rows, {
        search: "",
        process: "Beta",
        appProcessId: null,
        includeSystem: true,
      }).map((row) => row.id),
    ).toEqual(["2"]);
    expect(simLogProcesses([...rows, rows[0]!])).toEqual(["Alpha", "Beta"]);
  });

  test("hides non-app processes by PID until system logs are enabled", () => {
    expect(
      filterSimLogs(rows, {
        search: "",
        process: "",
        appProcessId: 101,
        includeSystem: false,
      }).map((row) => row.id),
    ).toEqual(["1"]);
    expect(
      filterSimLogs(rows, {
        search: "",
        process: "",
        appProcessId: 101,
        includeSystem: true,
      }).map((row) => row.id),
    ).toEqual(["1", "2"]);
    expect(
      filterSimLogs(rows, {
        search: "",
        process: "",
        appProcessId: null,
        includeSystem: false,
      }),
    ).toEqual([]);
  });
});

describe("buildSimLogsUrl", () => {
  test("preserves auth/device parameters while replacing the capture level", () => {
    expect(
      buildSimLogsUrl(
        "/preview/logs?device=DEVICE-1&token=secret&level=debug&processId=9",
        { level: "default", processId: 4242 },
        "http://127.0.0.1:3399/preview/",
      ),
    ).toBe(
      "http://127.0.0.1:3399/preview/logs?device=DEVICE-1&token=secret&level=default&processId=4242",
    );
    expect(
      buildSimLogsUrl(
        "/preview/logs?device=DEVICE-1&token=secret&processId=9",
        { level: "info", processId: null },
        "http://127.0.0.1:3399/preview/",
      ),
    ).toBe("http://127.0.0.1:3399/preview/logs?device=DEVICE-1&token=secret&level=info");
  });
});
