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
