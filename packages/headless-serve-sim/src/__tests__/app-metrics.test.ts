import { describe, expect, it } from "bun:test";
import {
  computeCpuPercent,
  parseCpuTimeToSeconds,
  sampleAppMetrics,
  type ProcReader,
} from "../app-metrics";

describe("parseCpuTimeToSeconds", () => {
  it("parses MM:SS.cc with unbounded minutes", () => {
    expect(parseCpuTimeToSeconds("2559:25.16")).toBeCloseTo(2559 * 60 + 25.16, 2);
  });
  it("parses HH:MM:SS", () => {
    expect(parseCpuTimeToSeconds("1:02:03")).toBe(3723);
  });
  it("parses DD-HH:MM:SS", () => {
    expect(parseCpuTimeToSeconds("2-03:04:05")).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });
  it("parses zero", () => {
    expect(parseCpuTimeToSeconds("0:00.00")).toBe(0);
  });
  it("parses a bare SS.cc with no colon", () => {
    expect(parseCpuTimeToSeconds("25.16")).toBeCloseTo(25.16, 2);
    expect(parseCpuTimeToSeconds("0")).toBe(0);
  });
  it("rejects junk", () => {
    expect(parseCpuTimeToSeconds("abc")).toBeNull();
    expect(parseCpuTimeToSeconds("")).toBeNull();
  });
  it("rejects whitespace-only input (trims to empty)", () => {
    expect(parseCpuTimeToSeconds("   ")).toBeNull();
  });
  it("rejects a non-numeric segment among otherwise valid parts", () => {
    expect(parseCpuTimeToSeconds("1:abc")).toBeNull();
  });
  it("rejects non-finite values like Infinity", () => {
    expect(parseCpuTimeToSeconds("Infinity")).toBeNull();
  });
  it("rejects more than 3 colon-separated parts", () => {
    expect(parseCpuTimeToSeconds("1:02:03:04")).toBeNull();
  });
  it("rejects a non-finite days component", () => {
    expect(parseCpuTimeToSeconds("x-01:02:03")).toBeNull();
  });
});

describe("computeCpuPercent", () => {
  it("is null while priming (no previous sample)", () => {
    expect(computeCpuPercent(undefined, { cpuSeconds: 1, atMs: 1000 })).toBeNull();
  });
  it("reads 100% for one CPU-second over one wall-second", () => {
    expect(computeCpuPercent({ cpuSeconds: 0, atMs: 0 }, { cpuSeconds: 1, atMs: 1000 })).toBeCloseTo(100);
  });
  it("reads 50% for half a CPU-second over one wall-second", () => {
    expect(computeCpuPercent({ cpuSeconds: 1, atMs: 0 }, { cpuSeconds: 1.5, atMs: 1000 })).toBeCloseTo(50);
  });
  it("exceeds 100% on multi-threaded load", () => {
    expect(computeCpuPercent({ cpuSeconds: 0, atMs: 0 }, { cpuSeconds: 2, atMs: 1000 })).toBeCloseTo(200);
  });
  it("is null when the CPU counter goes backwards (pid reuse)", () => {
    expect(computeCpuPercent({ cpuSeconds: 5, atMs: 0 }, { cpuSeconds: 1, atMs: 1000 })).toBeNull();
  });
  it("is null when no wall-clock time elapsed (wallSeconds == 0)", () => {
    expect(computeCpuPercent({ cpuSeconds: 0, atMs: 1000 }, { cpuSeconds: 1, atMs: 1000 })).toBeNull();
  });
  it("is null when the clock went backwards (wallSeconds < 0)", () => {
    expect(computeCpuPercent({ cpuSeconds: 0, atMs: 2000 }, { cpuSeconds: 1, atMs: 1000 })).toBeNull();
  });
  it("reads 0% when the CPU counter did not advance (idle)", () => {
    expect(computeCpuPercent({ cpuSeconds: 5, atMs: 0 }, { cpuSeconds: 5, atMs: 1000 })).toBe(0);
  });
  it("scales correctly with a sub-second wall interval", () => {
    // +0.25 CPU-sec over +0.5 wall-sec => 50%
    expect(computeCpuPercent({ cpuSeconds: 1, atMs: 1000 }, { cpuSeconds: 1.25, atMs: 1500 })).toBeCloseTo(50);
  });
});

describe("sampleAppMetrics", () => {
  it("primes on first read, then computes CPU% on the next", () => {
    let cpu = 10;
    const read: ProcReader = () => ({ rssKb: 1024, cpuSeconds: cpu });

    const first = sampleAppMetrics(4242, 1000, read);
    expect(first.alive).toBe(true);
    expect(first.rssBytes).toBe(1024 * 1024);
    expect(first.cpuPercent).toBeNull();

    cpu = 10.5; // +0.5 CPU-sec over +1 wall-sec => 50%
    const second = sampleAppMetrics(4242, 2000, read);
    expect(second.cpuPercent).toBeCloseTo(50);
  });

  it("reports not-alive and clears history when the process is gone", () => {
    const m = sampleAppMetrics(999999, 1000, () => null);
    expect(m.alive).toBe(false);
    expect(m.rssBytes).toBeNull();
    expect(m.cpuPercent).toBeNull();
  });

  it("uses the injected reader (never shells out to ps) and forwards the pid", () => {
    const seen: number[] = [];
    const read: ProcReader = (pid) => {
      seen.push(pid);
      return { rssKb: 2048, cpuSeconds: 3 };
    };
    const m = sampleAppMetrics(7777, 500, read);
    expect(seen).toEqual([7777]);
    expect(m.pid).toBe(7777);
    expect(m.rssBytes).toBe(2048 * 1024);
  });

  it("re-primes (cpuPercent null) after a dead read cleared the history", () => {
    const pid = 5151;
    let cpu = 100;
    const read: ProcReader = () => ({ rssKb: 512, cpuSeconds: cpu });

    // Prime, then land a real CPU% on the second poll.
    sampleAppMetrics(pid, 1000, read);
    cpu = 101;
    const primed = sampleAppMetrics(pid, 2000, read);
    expect(primed.cpuPercent).toBeCloseTo(100);

    // Process dies: history for this pid must be cleared.
    const dead = sampleAppMetrics(pid, 3000, () => null);
    expect(dead.alive).toBe(false);

    // Same pid comes back: with history cleared, the next sample must re-prime
    // (no stale prev to diff against), so cpuPercent is null again.
    cpu = 200;
    const reborn = sampleAppMetrics(pid, 4000, read);
    expect(reborn.alive).toBe(true);
    expect(reborn.cpuPercent).toBeNull();
  });

  it("keeps per-pid CPU history independent across distinct pids", () => {
    const readA: ProcReader = () => ({ rssKb: 1, cpuSeconds: 10 });
    const readB: ProcReader = () => ({ rssKb: 1, cpuSeconds: 20 });

    // Prime pid A only; sampling pid B for the first time must still prime (null),
    // proving histories aren't shared.
    sampleAppMetrics(8001, 1000, readA);
    const bFirst = sampleAppMetrics(8002, 1000, readB);
    expect(bFirst.cpuPercent).toBeNull();
  });
});
