export interface StreamLivenessSample {
  nowMs: number;
  connectionStartedAtMs: number;
  lastByteAtMs: number | null;
  oldestDecodeStartedAtMs: number | null;
}

export interface StreamLivenessThresholds {
  byteTimeoutMs: number;
  decodeTimeoutMs: number;
}

export type StreamLivenessAction = "none" | "reconnect" | "reset-decoder";

export const DEFAULT_STREAM_LIVENESS_THRESHOLDS: StreamLivenessThresholds = {
  byteTimeoutMs: 2_500,
  decodeTimeoutMs: 750,
};

/** Pure watchdog policy shared by the browser hook and deterministic tests. */
export function streamLivenessAction(
  sample: StreamLivenessSample,
  thresholds = DEFAULT_STREAM_LIVENESS_THRESHOLDS,
): StreamLivenessAction {
  const byteReference = sample.lastByteAtMs ?? sample.connectionStartedAtMs;
  if (sample.nowMs - byteReference >= thresholds.byteTimeoutMs) return "reconnect";
  if (
    sample.oldestDecodeStartedAtMs != null &&
    sample.nowMs - sample.oldestDecodeStartedAtMs >= thresholds.decodeTimeoutMs
  ) {
    return "reset-decoder";
  }
  return "none";
}

export interface KeyframeRecoverySample {
  nowMs: number;
  /** The decoder waits for a keyframe before any delta can decode. */
  awaitingKeyframe: boolean;
  /** When the current decoder was configured; null while there is none. */
  configuredAtMs: number | null;
  lastRequestAtMs: number | null;
}

/** Time the server's own forced keyframe gets before the viewer asks. */
const KEYFRAME_GRACE_MS = 500;
/** Between asks, so a slow encoder isn't flooded with IDR requests. */
const KEYFRAME_RETRY_MS = 1_000;

/**
 * A configured decoder waiting on a keyframe asks for one. The server forces
 * an IDR for each new viewer, but an encoder can swallow it, and on a still
 * screen nothing else ever produces another: the viewer would wait forever.
 */
export function keyframeRecoveryAction(sample: KeyframeRecoverySample): "none" | "request" {
  if (!sample.awaitingKeyframe || sample.configuredAtMs == null) return "none";
  if (sample.nowMs - sample.configuredAtMs < KEYFRAME_GRACE_MS) return "none";
  if (sample.lastRequestAtMs != null && sample.nowMs - sample.lastRequestAtMs < KEYFRAME_RETRY_MS)
    return "none";
  return "request";
}
