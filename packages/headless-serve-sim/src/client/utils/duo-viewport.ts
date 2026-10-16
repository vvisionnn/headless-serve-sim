import { simulatorMaxWidth } from "headless-serve-sim-client/simulator";

const ENVELOPE = 0.85;

function displayedEnvelope(availableWidth: number, availableHeight: number, scale: number) {
  const maxSize = simulatorMaxWidth("iphone", { width: 2, height: 1 });
  const fittedSize = Math.min(availableWidth, availableHeight, maxSize);
  return Math.min(availableWidth, availableHeight, fittedSize * scale);
}

/** Square output side, in device pixels, that maps 1:1 onto the displayed device. */
export function duoOutputSide(
  availableWidth: number,
  availableHeight: number,
  scale: number,
  pixelRatio: number,
): number {
  return Math.ceil(
    (displayedEnvelope(availableWidth, availableHeight, scale) * pixelRatio) / ENVELOPE,
  );
}

export function duoViewport(
  bounds: number[],
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
  scale = 1,
) {
  const x = Math.max(0, Math.floor(bounds[0]! * width)),
    y = Math.max(0, Math.floor(bounds[1]! * height));
  const right = Math.min(width, Math.ceil((bounds[0]! + bounds[2]!) * width));
  const bottom = Math.min(height, Math.ceil((bounds[1]! + bounds[3]!) * height));
  const crop = { x, y, width: right - x, height: bottom - y };
  // Fit the fixed native envelope, not the changing fold silhouette.
  const frameSize = Math.max(width, height) * ENVELOPE;
  const displayScale = displayedEnvelope(availableWidth, availableHeight, scale) / frameSize;
  return { crop, width: crop.width * displayScale, height: crop.height * displayScale };
}
