import type { RecordingController } from "../shell/shell-context";

/**
 * The dock capsule's seconds. It counts while recording; from the stop it
 * holds the last value while the capsule closes, so the count never drops
 * to 0:00 in front of the user, and goes back to zero only when the next
 * recording is asked for.
 */
export function recordTimerSecs(
  shown: number,
  status: RecordingController["status"],
  startedAt: number | null,
  now: number,
): number {
  if (status === "recording" && startedAt != null)
    return Math.max(0, Math.floor((now - startedAt) / 1000));
  if (status === "preparing") return 0;
  return shown;
}

export function formatRecordTimer(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
