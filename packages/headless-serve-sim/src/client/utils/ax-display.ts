import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";
import type { AxRect, AxSnapshot } from "../../ax-shared";

type Size = { width: number; height: number };

const isLandscape = (o: SimulatorOrientation) => o.startsWith("landscape");

// The helper's AXInterfaceFrame: the fixed (portrait) screen `s` against an
// interface turned to `o`.
function fromFixed(r: AxRect, s: Size, o: SimulatorOrientation): AxRect {
  const { x, y, width: w, height: h } = r;
  switch (o) {
    case "landscape_left":
      return { x: s.height - y - h, y: x, width: h, height: w };
    case "landscape_right":
      return { x: y, y: s.width - x - w, width: h, height: w };
    case "portrait_upside_down":
      return { x: s.width - x - w, y: s.height - y - h, width: w, height: h };
    default:
      return r;
  }
}

function toFixed(r: AxRect, s: Size, o: SimulatorOrientation): AxRect {
  const { x, y, width: w, height: h } = r;
  switch (o) {
    case "landscape_left":
      return { x: y, y: s.height - x - w, width: h, height: w };
    case "landscape_right":
      return { x: s.width - y - h, y: x, width: h, height: w };
    case "portrait_upside_down":
      return { x: s.width - x - w, y: s.height - y - h, width: w, height: h };
    default:
      return r;
  }
}

/**
 * AX frames are laid out in the interface's orientation, but the screen is
 * drawn in the device's: a portrait-only app on a phone held sideways shows
 * sideways. Turn the snapshot to match what's drawn.
 */
export function axSnapshotForDisplay(
  snapshot: AxSnapshot,
  interfaceOrientation: SimulatorOrientation | undefined,
  displayOrientation: SimulatorOrientation | undefined,
): AxSnapshot {
  if (!interfaceOrientation || !displayOrientation || interfaceOrientation === displayOrientation)
    return snapshot;
  // The snapshot's own shape decides: the reported orientation comes from the
  // stream and can lag an app that just turned. When it disagrees, trust the
  // device's if that fits, else the usual way up for that shape.
  const { width, height } = snapshot.screen;
  const landscape = width > height;
  const laidOut: SimulatorOrientation =
    isLandscape(interfaceOrientation) === landscape
      ? interfaceOrientation
      : isLandscape(displayOrientation) === landscape
        ? displayOrientation
        : landscape
          ? "landscape_right"
          : "portrait";
  if (laidOut === displayOrientation) return snapshot;
  const fixed = landscape ? { width: height, height: width } : { width, height };
  return {
    ...snapshot,
    screen: isLandscape(displayOrientation) ? { width: fixed.height, height: fixed.width } : fixed,
    elements: snapshot.elements.map((element) => ({
      ...element,
      frame: fromFixed(toFixed(element.frame, fixed, laidOut), fixed, displayOrientation),
    })),
  };
}
