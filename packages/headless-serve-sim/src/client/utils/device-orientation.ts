import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";

/**
 * devicectl's physical orientation in the stream's (interface) vocabulary:
 * the device turned counter-clockwise is UIDevice `landscapeLeft`, which the
 * interface draws as `landscape_right`. Flat or unknown → null.
 */
export function screenOrientationForDevice(
  physical: string | null | undefined,
): SimulatorOrientation | null {
  switch (physical) {
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

/**
 * The panel's framebuffer is fixed to the glass, so the device's orientation —
 * not the foreground app's — decides how it is drawn, as in Simulator.app. A
 * portrait-only app on a device held sideways shows sideways. Composited
 * streams already draw their own rotation.
 */
export function withDeviceOrientation<
  T extends { orientation?: SimulatorOrientation; deviceComposition?: boolean },
>(config: T, orientation: SimulatorOrientation | null): T {
  if (!orientation || config.deviceComposition || config.orientation === orientation) return config;
  return { ...config, orientation };
}
