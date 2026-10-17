import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";

/** Simulator.app's "Rotate Left": one quarter turn counter-clockwise. */
const ROTATE_LEFT: Record<SimulatorOrientation, SimulatorOrientation> = {
  portrait: "landscape_left",
  landscape_left: "portrait_upside_down",
  portrait_upside_down: "landscape_right",
  landscape_right: "portrait",
};

export function rotateLeft(orientation: SimulatorOrientation): SimulatorOrientation {
  return ROTATE_LEFT[orientation];
}
