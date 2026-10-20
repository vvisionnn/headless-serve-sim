import type { RecordingController } from "../shell/shell-context";

/**
 * Whether the record button shows as the red capsule. It opens as soon as a
 * start is asked for — the recorder may still be loading — and only falls
 * back to the round button at idle, so a failed start springs back.
 */
export function recordMorphed(status: RecordingController["status"]): boolean {
  return status !== "idle";
}
