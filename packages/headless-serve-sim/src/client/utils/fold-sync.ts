import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";

export function observedDuoOrientation(
  physical: string | null | undefined,
  requestedRevision: number,
  currentRevision: number,
  pending: boolean,
  commanded?: string | null,
): SimulatorOrientation | null {
  if (pending || requestedRevision !== currentRevision) return null;
  switch (commanded ?? physical) {
    case "portrait":
      return "portrait";
    case "portraitUpsideDown":
      return "portrait_upside_down";
    case "landscapeLeft":
      return "landscape_right";
    case "landscapeRight":
      return "landscape_left";
    default:
      return null;
  }
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
