import { describe, expect, test } from "bun:test";
import { selectServeSimState, type ServeSimState } from "../middleware";

// The server seam the pinned SSE relies on. When the client subscribes with an
// explicit ?device= (auto-connect OFF), the server must resolve strictly to that
// device — returning null once it's gone rather than falling back to a different
// booted helper. Only the "no device" path (auto-connect ON) may fall back.
function state(device: string, port: number): ServeSimState {
  return {
    pid: 1,
    port,
    device,
    url: `http://127.0.0.1:${port}`,
    streamUrl: `http://127.0.0.1:${port}/stream.mjpeg`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  };
}

describe("selectServeSimState (pin contract)", () => {
  const A = state("UDID-A", 1);
  const B = state("UDID-B", 2);

  test("an explicit device resolves to exactly that device", () => {
    expect(selectServeSimState([A, B], "UDID-A")).toBe(A);
    expect(selectServeSimState([A, B], "UDID-B")).toBe(B);
  });

  test("an explicit device that is gone returns null — never a different booted one", () => {
    // A shut down, B still booted. A pinned subscription must NOT hop to B.
    expect(selectServeSimState([B], "UDID-A")).toBeNull();
  });

  test("no device falls back to the first booted helper (legacy auto-connect)", () => {
    expect(selectServeSimState([A, B], null)).toBe(A);
    expect(selectServeSimState([B], undefined)).toBe(B);
  });

  test("no device with nothing booted returns null", () => {
    expect(selectServeSimState([], null)).toBeNull();
  });
});
