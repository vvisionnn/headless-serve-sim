import { describe, expect, test } from "bun:test";
import { selectServeSimState, type ServeSimState } from "../middleware";

// The server seam the pinned SSE relies on. When the client subscribes with an
// An explicit ?device= must resolve strictly to that device — returning null
// once it's gone rather than falling back to a different booted helper. A
// missing device means the user has not selected anything, so it is also null.
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

  test("no device never selects a booted helper", () => {
    expect(selectServeSimState([A, B], null)).toBeNull();
    expect(selectServeSimState([B], undefined)).toBeNull();
  });

  test("no device with nothing booted returns null", () => {
    expect(selectServeSimState([], null)).toBeNull();
  });
});
