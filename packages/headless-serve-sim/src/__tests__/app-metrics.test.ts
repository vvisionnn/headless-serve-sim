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
  it("rejects junk", () => {
    expect(parseCpuTimeToSeconds("abc")).toBeNull();
    expect(parseCpuTimeToSeconds("")).toBeNull();
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
});
