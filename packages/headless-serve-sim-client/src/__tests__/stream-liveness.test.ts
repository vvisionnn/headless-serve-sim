import { describe, expect, test } from "bun:test";
import { streamLivenessAction } from "../stream-liveness";

const thresholds = { byteTimeoutMs: 2_500, decodeTimeoutMs: 750 };

describe("stream liveness watchdog", () => {
  test("reconnects a connection that never produces response bytes", () => {
    expect(
      streamLivenessAction(
        {
          nowMs: 2_500,
          connectionStartedAtMs: 0,
          lastByteAtMs: null,
          oldestDecodeStartedAtMs: null,
        },
        thresholds,
      ),
    ).toBe("reconnect");
  });

  test("recent heartbeat bytes keep an idle stream alive", () => {
    expect(
      streamLivenessAction(
        {
          nowMs: 5_000,
          connectionStartedAtMs: 0,
          lastByteAtMs: 4_900,
          oldestDecodeStartedAtMs: null,
        },
        thresholds,
      ),
    ).toBe("none");
  });

  test("resets a decoder whose submitted media never produces output", () => {
    expect(
      streamLivenessAction(
        {
          nowMs: 5_000,
          connectionStartedAtMs: 0,
          lastByteAtMs: 4_950,
          oldestDecodeStartedAtMs: 4_200,
        },
        thresholds,
      ),
    ).toBe("reset-decoder");
  });

  test("network recovery takes priority over decoder recovery", () => {
    expect(
      streamLivenessAction(
        {
          nowMs: 5_000,
          connectionStartedAtMs: 0,
          lastByteAtMs: 2_000,
          oldestDecodeStartedAtMs: 1_000,
        },
        thresholds,
      ),
    ).toBe("reconnect");
  });
});
