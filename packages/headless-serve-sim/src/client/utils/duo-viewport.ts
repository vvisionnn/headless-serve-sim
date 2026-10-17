/**
 * The share of the square composite the Duo's silhouette can reach in any fold
 * pose, portrait (measured across folded, book and open). Fitting this extent
 * rather than the current silhouette keeps one scale while the device folds.
 */
const EXTENT = { width: 0.82, height: 0.63 };

/** Displayed side of the whole square composite, in CSS px. */
function displayedFrame(
  availableWidth: number,
  availableHeight: number,
  scale: number,
  landscape: boolean,
) {
  const extentWidth = landscape ? EXTENT.height : EXTENT.width;
  const extentHeight = landscape ? EXTENT.width : EXTENT.height;
  const fitted = Math.min(availableWidth / extentWidth, availableHeight / extentHeight);
  return fitted * Math.min(1, scale);
}

/** Square output side, in device pixels, that maps 1:1 onto the displayed device. */
export function duoOutputSide(
  availableWidth: number,
  availableHeight: number,
  scale: number,
  pixelRatio: number,
  landscape = false,
): number {
  return Math.ceil(displayedFrame(availableWidth, availableHeight, scale, landscape) * pixelRatio);
}

export function duoViewport(
  bounds: number[],
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
  scale = 1,
  landscape = false,
) {
  const x = Math.max(0, Math.floor(bounds[0]! * width)),
    y = Math.max(0, Math.floor(bounds[1]! * height));
  const right = Math.min(width, Math.ceil((bounds[0]! + bounds[2]!) * width));
  const bottom = Math.min(height, Math.ceil((bounds[1]! + bounds[3]!) * height));
  const crop = { x, y, width: right - x, height: bottom - y };
  const displayScale =
    displayedFrame(availableWidth, availableHeight, scale, landscape) / Math.max(width, height);
  return { crop, width: crop.width * displayScale, height: crop.height * displayScale };
}
