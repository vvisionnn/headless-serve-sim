import { describe, expect, test } from "bun:test";
import {
  AVCC_MAX_CONSECUTIVE_DECODER_ERRORS,
  avccFallbackReducer,
  initialAvccFallback,
  type AvccFallbackState,
} from "../client/avcc-fallback";

/** Apply a sequence of events from the initial state. */
function run(events: Parameters<typeof avccFallbackReducer>[1][]): AvccFallbackState {
  return events.reduce(avccFallbackReducer, initialAvccFallback);
}

/** N decoder errors in a row. */
function errors(count: number): Parameters<typeof avccFallbackReducer>[1][] {
  return Array.from({ length: count }, () => "error" as const);
}

describe("avccFallbackReducer", () => {
  test("starts on AVCC (no fallback) until told otherwise", () => {
    expect(initialAvccFallback).toEqual({
      streamed: false,
      fellBack: false,
      consecutiveErrors: 0,
    });
  });

  test("timeout without a frame falls back to MJPEG", () => {
    // The repro: helper has no /stream.avcc route, so no frame ever arrives.
    expect(run(["timeout"]).fellBack).toBe(true);
  });

  test("a frame before timeout keeps AVCC", () => {
    // Healthy helper paints its JPEG seed first, cancelling the fallback.
    const state = run(["frame", "timeout"]);
    expect(state.streamed).toBe(true);
    expect(state.fellBack).toBe(false);
  });

  test("a late stall does not downgrade a stream that already worked", () => {
    // frame → working; a later timeout (e.g. transient stall) must not flip us
    // to MJPEG permanently.
    expect(run(["frame", "timeout", "timeout"]).fellBack).toBe(false);
  });

  test("reset re-arms AVCC after a device switch / reconnect", () => {
    const fellBack = run(["timeout"]);
    expect(fellBack.fellBack).toBe(true);
    expect(avccFallbackReducer(fellBack, "reset")).toEqual(initialAvccFallback);
  });

  test("once fallen back, further timeouts are idempotent", () => {
    const once = run(["timeout"]);
    expect(avccFallbackReducer(once, "timeout")).toEqual(once);
  });
});

describe("avccFallbackReducer decoder errors", () => {
  // The stream layer answers a decoder fault by recreating the decoder and
  // reconnecting, and that recovers a transient one. Downgrading on the first
  // error would throw away a working H.264 stream over a single blip.
  test("a single decoder error keeps AVCC", () => {
    const state = run(["frame", "error"]);
    expect(state.fellBack).toBe(false);
  });

  test("recovery below the threshold keeps AVCC indefinitely", () => {
    // Error → frame → error → frame …: the decoder keeps coming back, so the
    // run never reaches the threshold no matter how long it flaps.
    const flapping = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? ("error" as const) : ("frame" as const),
    );
    expect(run(flapping).fellBack).toBe(false);
  });

  test("a painted frame clears the error run", () => {
    const state = run([...errors(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS - 1), "frame"]);
    expect(state.consecutiveErrors).toBe(0);
    expect(state.fellBack).toBe(false);
  });

  // The failure upstream describes: VideoToolbox starved by a screen recorder.
  // Recreate-and-retry loops forever, so consecutive failures must give up.
  test("consecutive errors with no frame between them fall back", () => {
    expect(run(errors(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS)).fellBack).toBe(true);
  });

  test("falls back only once the threshold is reached, not before", () => {
    expect(run(errors(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS - 1)).fellBack).toBe(false);
  });

  // Unlike `timeout`, this downgrades even after AVCC was working — a decoder
  // that dies repeatedly mid-stream is not viable regardless of past success.
  test("falls back mid-stream after frames already flowed", () => {
    expect(run(["frame", ...errors(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS)]).fellBack).toBe(true);
  });

  test("errors after falling back are idempotent", () => {
    const downgraded = run(errors(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS));
    expect(avccFallbackReducer(downgraded, "error")).toEqual(downgraded);
  });

  test("reset re-arms AVCC after an error downgrade", () => {
    const downgraded = run(errors(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS));
    expect(avccFallbackReducer(downgraded, "reset")).toEqual(initialAvccFallback);
  });

  test("the threshold is above 1 so a blip never downgrades", () => {
    expect(AVCC_MAX_CONSECUTIVE_DECODER_ERRORS).toBeGreaterThan(1);
  });
});
