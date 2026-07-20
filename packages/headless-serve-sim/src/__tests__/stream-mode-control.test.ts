import { describe, expect, test } from "bun:test";
import { reconcileStreamMode, sendStreamMode } from "../client/utils/stream-mode-control";

describe("stream mode control", () => {
  test("retains a Quality request while disconnected and sends it after reconnect", () => {
    const sent: ArrayBuffer[] = [];
    const closed = { readyState: 3, send: (data: ArrayBuffer) => sent.push(data) };
    const open = { readyState: 1, send: (data: ArrayBuffer) => sent.push(data) };

    expect(sendStreamMode(closed, "quality")).toBe(false);
    expect(sent).toHaveLength(0);
    expect(sendStreamMode(open, "quality")).toBe(true);
    expect(sent).toHaveLength(1);
    const message = new Uint8Array(sent[0]!);
    expect(message[0]).toBe(0x0c);
    expect(JSON.parse(new TextDecoder().decode(message.subarray(1)))).toEqual({
      mode: "quality",
    });
  });

  test("a stale server report cannot overwrite an unacknowledged request", () => {
    expect(reconcileStreamMode({ mode: "quality", mismatches: 0 }, "perf")).toEqual({
      mode: "quality",
      pending: { mode: "quality", mismatches: 1 },
    });
    expect(reconcileStreamMode({ mode: "quality", mismatches: 0 }, "quality")).toEqual({
      mode: "quality",
      pending: null,
    });
    expect(reconcileStreamMode(null, "perf")).toEqual({
      mode: "perf",
      pending: null,
    });
  });

  test("accepts authoritative server state after a bounded optimistic window", () => {
    const first = reconcileStreamMode({ mode: "quality", mismatches: 0 }, "perf");
    expect(reconcileStreamMode(first.pending, "perf")).toEqual({
      mode: "perf",
      pending: null,
    });
  });
});
