import { describe, expect, test } from "bun:test";
import { keyframeRecoveryAction, streamLivenessAction } from "../stream-liveness";

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

// A decoder configured for a stream waits for its keyframe. If the encoder
// swallowed the one the server forced, nothing else will send another on a
// still screen: the viewer must ask, again, until one lands.
describe("keyframe recovery", () => {
  test("asks for a keyframe a configured decoder is still waiting on", () => {
    expect(
      keyframeRecoveryAction({
        awaitingKeyframe: true,
        configuredAtMs: 0,
        lastRequestAtMs: null,
        nowMs: 600,
      }),
    ).toBe("request");
  });

  test("gives the server's own keyframe a moment first", () => {
    expect(
      keyframeRecoveryAction({
        awaitingKeyframe: true,
        configuredAtMs: 0,
        lastRequestAtMs: null,
        nowMs: 200,
      }),
    ).toBe("none");
  });

  test("asks again while it still hasn't come, but not in a storm", () => {
    const waiting = { awaitingKeyframe: true, configuredAtMs: 0 };
    expect(keyframeRecoveryAction({ ...waiting, lastRequestAtMs: 600, nowMs: 900 })).toBe("none");
    expect(keyframeRecoveryAction({ ...waiting, lastRequestAtMs: 600, nowMs: 1_700 })).toBe(
      "request",
    );
  });

  test("leaves a decoding stream, or one with no decoder yet, alone", () => {
    expect(
      keyframeRecoveryAction({
        awaitingKeyframe: false,
        configuredAtMs: 0,
        lastRequestAtMs: null,
        nowMs: 5_000,
      }),
    ).toBe("none");
    expect(
      keyframeRecoveryAction({
        awaitingKeyframe: true,
        configuredAtMs: null,
        lastRequestAtMs: null,
        nowMs: 5_000,
      }),
    ).toBe("none");
  });
});
