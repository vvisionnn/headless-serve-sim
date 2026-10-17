import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";
import { screenOrientationForDevice } from "./device-orientation";

export function observedDuoOrientation(
  physical: string | null | undefined,
  requestedRevision: number,
  currentRevision: number,
  pending: boolean,
  commanded?: string | null,
): SimulatorOrientation | null {
  if (pending || requestedRevision !== currentRevision) return null;
  // The server retains a command only until guest convergence or a bounded timeout.
  return screenOrientationForDevice(commanded ?? physical);
}

export function shouldApplyObservedHinge(state: {
  requestedRevision: number;
  currentRevision: number;
  pending: boolean;
  animating?: boolean;
  angle: unknown;
}): boolean {
  return (
    !state.pending &&
    !state.animating &&
    state.requestedRevision === state.currentRevision &&
    typeof state.angle === "number" &&
    Number.isFinite(state.angle) &&
    state.angle >= 0 &&
    state.angle <= 180
  );
}
