import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";

/**
 * Simulator.app's "Rotate Left": one quarter turn counter-clockwise. The
 * orientations are the interface's, so turning the device's top to the left
 * is `landscape_right` (home on the right).
 */
const ROTATE_LEFT: Record<SimulatorOrientation, SimulatorOrientation> = {
  portrait: "landscape_right",
  landscape_right: "portrait_upside_down",
  portrait_upside_down: "landscape_left",
  landscape_left: "portrait",
};

export function rotateLeft(orientation: SimulatorOrientation): SimulatorOrientation {
  return ROTATE_LEFT[orientation];
}
