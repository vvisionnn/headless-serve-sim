import { describe, expect, test } from "bun:test";
import { createSimLogFeed, forwardSimLogToConsole } from "../client/utils/sim-log-feed";

class FakeEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
  }
}

describe("createSimLogFeed", () => {
  test("reports lifecycle state and batches valid messages into one animation frame", () => {
    const source = new FakeEventSource();
    const statuses: string[] = [];
    const batches: string[][] = [];
    const scheduled: Array<FrameRequestCallback> = [];

    const feed = createSimLogFeed({
      endpoint: "/logs?device=D&token=T",
      level: "debug",
      baseUrl: "http://localhost:3399/",
      idPrefix: "feed",
      eventSourceFactory: (url) => {
        expect(url).toBe("http://localhost:3399/logs?device=D&token=T&level=debug");
        return source;
      },
      scheduleFrame: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelFrame: () => {},
      onStatus: (status) => statuses.push(status),
      onBatch: (entries) => batches.push(entries.map((entry) => entry.id)),
    });

    expect(statuses).toEqual(["connecting"]);
    source.onopen?.(new Event("open"));
    source.onmessage?.({ data: JSON.stringify({ eventMessage: "one" }) } as MessageEvent<string>);
    source.onmessage?.({ data: "not json" } as MessageEvent<string>);
    source.onmessage?.({ data: JSON.stringify({ eventMessage: "two" }) } as MessageEvent<string>);
    expect(scheduled).toHaveLength(1);
    scheduled[0]!(0);
    expect(batches).toEqual([["feed-1", "feed-2"]]);

    source.onerror?.(new Event("error"));
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
    feed.stop();
    feed.stop();
    expect(source.closed).toBe(true);
  });

  test("cancels a pending batch and ignores events after stop", () => {
    const source = new FakeEventSource();
    const cancelled: number[] = [];
    const batches: number[] = [];
    let callback: FrameRequestCallback | null = null;
    const feed = createSimLogFeed({
      endpoint: "/logs",
      level: "info",
      baseUrl: "http://localhost/",
      eventSourceFactory: () => source,
      scheduleFrame: (next) => { callback = next; return 42; },
      cancelFrame: (id) => cancelled.push(id),
      onStatus: () => {},
      onBatch: (entries) => batches.push(entries.length),
    });

    source.onmessage?.({ data: JSON.stringify({ eventMessage: "queued" }) } as MessageEvent<string>);
    feed.stop();
    const cancelledCallback = callback as FrameRequestCallback | null;
    cancelledCallback?.(0);
    source.onmessage?.({ data: JSON.stringify({ eventMessage: "late" }) } as MessageEvent<string>);
    expect(cancelled).toEqual([42]);
    expect(batches).toEqual([]);
  });

  test("bounds the pending live tail while animation frames are suspended", () => {
    const source = new FakeEventSource();
    const batches: string[][] = [];
    let callback: FrameRequestCallback | null = null;
    const feed = createSimLogFeed({
      endpoint: "/logs",
      level: "info",
      baseUrl: "http://localhost/",
      idPrefix: "background",
      maxPendingEntries: 2,
      maxPendingBytes: 1_000,
      eventSourceFactory: () => source,
      scheduleFrame: (next) => { callback = next; return 1; },
      cancelFrame: () => {},
      onStatus: () => {},
      onBatch: (entries) => batches.push(entries.map((entry) => entry.id)),
    });

    for (const message of ["one", "two", "three"]) {
      source.onmessage?.({ data: JSON.stringify({ eventMessage: message }) } as MessageEvent<string>);
    }
    const suspendedFrame = callback as FrameRequestCallback | null;
    suspendedFrame?.(0);
    expect(batches).toEqual([["background-2", "background-3"]]);
    feed.stop();
  });
});

describe("forwardSimLogToConsole", () => {
  test("passes the message as data instead of a console format string", () => {
    const calls: unknown[][] = [];
    forwardSimLogToConsole({
      id: "1",
      timestamp: "",
      process: "App",
      subsystem: "com.example",
      category: "test",
      level: "error",
      message: "%c hostile <script>",
      byteSize: 1,
    }, { log: (...args: unknown[]) => calls.push(args) });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.at(-1)).toBe("%c hostile <script>");
    expect(calls[0]?.[0]).not.toContain("hostile");
  });
});
