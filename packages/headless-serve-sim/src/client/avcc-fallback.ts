/**
 * Fallback latch for the AVCC (H.264) video path.
 *
 * The client commits to AVCC whenever the *browser* can decode H.264
 * (WebCodecs). But the *server* may not actually serve `/stream.avcc`: a
 * device started from an older installed CLI may predate H.264 and 404 the
 * endpoint. Cross-origin that 404 is opaque to `fetch`, so the only reliable
 * signal is "no frame ever arrived." This reducer drives a one-shot timeout:
 * if AVCC produces no frame within the window, we fall back to MJPEG (which
 * every helper serves) and stay there for the session. A working helper paints
 * its JPEG seed within ~1s, so it trips the `frame` event long before timeout.
 *
 * Pure and framework-free so the transition logic is unit-testable; the timer
 * and `dispatch` live in the component.
 */
export interface AvccFallbackState {
  /** True once AVCC has yielded a frame for the current stream. */
  streamed: boolean;
  /** True once we've given up on AVCC and switched to MJPEG. */
  fellBack: boolean;
  /** Decoder errors since the last painted frame. Reset by `frame`. */
  consecutiveErrors: number;
}

export type AvccFallbackEvent =
  /** A frame (seed or decoded) was painted under AVCC. */
  | "frame"
  /** The startup window elapsed; fall back unless a frame already arrived. */
  | "timeout"
  /**
   * The WebCodecs decoder failed fatally. The stream layer already answers this
   * by recreating the decoder and reconnecting, which recovers a transient
   * fault — so a single error must NOT downgrade. What it can't answer is a
   * persistent one (VideoToolbox starved by a screen recorder, say): there,
   * recreate-and-retry just loops. Repeated errors with no frame in between are
   * the signal that recovery isn't working.
   */
  | "error"
  /** Target stream changed (device switch / reconnect) — re-arm AVCC. */
  | "reset";

/**
 * Consecutive decoder errors, with no frame painted between them, before we
 * stop retrying H.264 and drop to MJPEG for the session. Above 1 so a
 * recoverable blip keeps the better codec; low enough that a wedged decoder
 * doesn't spin for long.
 */
export const AVCC_MAX_CONSECUTIVE_DECODER_ERRORS = 3;

export const initialAvccFallback: AvccFallbackState = {
  streamed: false,
  fellBack: false,
  consecutiveErrors: 0,
};

export function avccFallbackReducer(
  state: AvccFallbackState,
  event: AvccFallbackEvent,
): AvccFallbackState {
  switch (event) {
    case "frame":
      // A painted frame proves the decoder recovered, so the error run ends.
      return state.streamed && state.consecutiveErrors === 0
        ? state
        : { ...state, streamed: true, consecutiveErrors: 0 };
    case "timeout":
      // Only fall back if AVCC never produced a frame. A later stall (helper
      // dies mid-session) is handled by the normal reconnect path, not by
      // permanently downgrading a stream that was working.
      return state.streamed || state.fellBack ? state : { ...state, fellBack: true };
    case "error": {
      if (state.fellBack) return state;
      const consecutiveErrors = state.consecutiveErrors + 1;
      return {
        ...state,
        consecutiveErrors,
        fellBack: consecutiveErrors >= AVCC_MAX_CONSECUTIVE_DECODER_ERRORS,
      };
    }
    case "reset":
      return initialAvccFallback;
  }
}

/**
 * Startup window before giving up on AVCC and falling back to MJPEG. Long
 * enough that a healthy helper's JPEG seed (sub-second) always lands first,
 * short enough that a dead AVCC endpoint doesn't strand the preview on
 * "Connecting…".
 */
export const AVCC_FRAME_TIMEOUT_MS = 4000;
