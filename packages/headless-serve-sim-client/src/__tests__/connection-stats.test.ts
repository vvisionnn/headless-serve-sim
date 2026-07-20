import { describe, expect, test } from "bun:test";
import {
  ConnectionStatsAccumulator,
  parseServerStreamStats,
  summarize,
  type FrameSample,
} from "../connection-stats";

function feed(acc: ConnectionStatsAccumulator, samples: FrameSample[]) {
  for (const s of samples) acc.recordFrame(s);
}

describe("ConnectionStatsAccumulator", () => {
  test("empty accumulator reports zeros", () => {
    const s = new ConnectionStatsAccumulator().snapshot(0);
    expect(s.fps).toBe(0);
    expect(s.bitrateBps).toBe(0);
    expect(s.jitterMs).toBe(0);
    expect(s.decodeMs).toBeNull();
    expect(s.droppedFrames).toBe(0);
    expect(s.frames).toBe(0);
  });

  test("single frame cannot derive a rate but keeps its decode time", () => {
    const acc = new ConnectionStatsAccumulator();
    feed(acc, [{ tMs: 0, bytes: 1000, decodeMs: 3 }]);
    const s = acc.snapshot(0);
    expect(s.fps).toBe(0);
    expect(s.bitrateBps).toBe(0);
    expect(s.frames).toBe(1);
    expect(s.decodeMs).toBeCloseTo(3, 6);
  });

  test("steady 50fps / 1000B stream yields exact fps + bitrate, zero jitter", () => {
    const acc = new ConnectionStatsAccumulator();
    feed(
      acc,
      [0, 20, 40, 60, 80].map((tMs) => ({ tMs, bytes: 1000, decodeMs: null })),
    );
    const s = acc.snapshot(80);
    expect(s.fps).toBeCloseTo(50, 6);
    // exclude first frame: 4 × 1000 B over 80 ms → 400 000 bps
    expect(s.bitrateBps).toBeCloseTo(400_000, 3);
    expect(s.jitterMs).toBeCloseTo(0, 6);
    expect(s.decodeMs).toBeNull();
    expect(s.frames).toBe(5);
  });

  test("uneven arrival produces non-zero jitter", () => {
    const acc = new ConnectionStatsAccumulator();
    // intervals 10,30,10,30 → mean 20, population stddev 10
    feed(
      acc,
      [0, 10, 40, 50, 80].map((tMs) => ({ tMs, bytes: 500, decodeMs: null })),
    );
    const s = acc.snapshot(80);
    expect(s.fps).toBeCloseTo(50, 6);
    expect(s.jitterMs).toBeCloseTo(10, 6);
  });

  test("window prunes frames older than the window", () => {
    const acc = new ConnectionStatsAccumulator(2000);
    feed(acc, [
      { tMs: 0, bytes: 9999, decodeMs: null },
      { tMs: 3000, bytes: 1000, decodeMs: null },
      { tMs: 3020, bytes: 1000, decodeMs: null },
      { tMs: 3040, bytes: 1000, decodeMs: null },
    ]);
    const s = acc.snapshot(3040);
    expect(s.frames).toBe(3); // the t=0 frame is evicted
    expect(s.fps).toBeCloseTo(50, 6);
  });

  test("decode time averages only measured frames; null when none", () => {
    const avcc = new ConnectionStatsAccumulator();
    feed(avcc, [
      { tMs: 0, bytes: 1, decodeMs: 2 },
      { tMs: 20, bytes: 1, decodeMs: 4 },
      { tMs: 40, bytes: 1, decodeMs: 6 },
      { tMs: 60, bytes: 1, decodeMs: null },
    ]);
    expect(avcc.snapshot(60).decodeMs).toBeCloseTo(4, 6);

    const mjpeg = new ConnectionStatsAccumulator();
    feed(
      mjpeg,
      [0, 20, 40].map((tMs) => ({ tMs, bytes: 1, decodeMs: null })),
    );
    expect(mjpeg.snapshot(40).decodeMs).toBeNull();
  });

  test("drops accumulate and reset clears state", () => {
    const acc = new ConnectionStatsAccumulator();
    acc.recordDrop();
    acc.recordDrop(2);
    feed(
      acc,
      [0, 20].map((tMs) => ({ tMs, bytes: 1, decodeMs: null })),
    );
    expect(acc.snapshot(20).droppedFrames).toBe(3);
    acc.reset();
    const cleared = acc.snapshot(20);
    expect(cleared.droppedFrames).toBe(0);
    expect(cleared.frames).toBe(0);
  });

  test("identical timestamps don't produce Infinity", () => {
    const acc = new ConnectionStatsAccumulator();
    feed(acc, [
      { tMs: 100, bytes: 1, decodeMs: null },
      { tMs: 100, bytes: 1, decodeMs: null },
    ]);
    const s = acc.snapshot(100);
    expect(Number.isFinite(s.fps)).toBe(true);
    expect(s.fps).toBe(0);
    expect(Number.isFinite(s.bitrateBps)).toBe(true);
    expect(s.bitrateBps).toBe(0);
  });
});

describe("summarize", () => {
  test("empty series is all zero", () => {
    expect(summarize([])).toEqual({ min: 0, avg: 0, max: 0, last: 0 });
  });

  test("computes min/avg/max/last", () => {
    expect(summarize([41, 57, 60])).toEqual({
      min: 41,
      avg: (41 + 57 + 60) / 3,
      max: 60,
      last: 60,
    });
  });

  test("handles a flat series", () => {
    expect(summarize([5, 5, 5])).toEqual({ min: 5, avg: 5, max: 5, last: 5 });
  });
});

describe("parseServerStreamStats", () => {
  test("maps adaptive stats and queue diagnostics from the wire payload", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        mode: "perf",
        targetBitrate: 12_000_000,
        maxQP: 46,
        congested: false,
        serverFps: 60,
        queueBytes: 8192,
        queueMs: 5,
        droppedFrames: 2,
      }),
    );

    expect(parseServerStreamStats(payload)).toEqual({
      mode: "perf",
      targetBitrateBps: 12_000_000,
      maxQP: 46,
      congested: false,
      serverFps: 60,
      queueBytes: 8192,
      queueMs: 5,
      droppedFrames: 2,
    });
  });

  test("defaults queue diagnostics for older helpers", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        mode: "perf",
        targetBitrate: 12_000_000,
        maxQP: 46,
        congested: false,
        serverFps: 60,
      }),
    );

    expect(parseServerStreamStats(payload)?.queueMs).toBe(0);
    expect(parseServerStreamStats(payload)?.droppedFrames).toBe(0);
  });

  test("rejects an unknown stream mode instead of desynchronizing controlled UI", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        mode: "ultra",
        targetBitrate: 12_000_000,
        maxQP: 46,
        congested: false,
        serverFps: 60,
      }),
    );
    expect(parseServerStreamStats(payload)).toBeNull();
  });
});
