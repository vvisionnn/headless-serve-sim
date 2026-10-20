/**
 * The share of the square composite the Duo's silhouette can reach in any fold
 * pose, portrait (measured across folded, book and open). Fitting this extent
 * rather than the current silhouette keeps one scale while the device folds.
 */
const EXTENT = { width: 0.82, height: 0.63 };

/**
 * Displayed side of the whole square composite, in CSS px. The extent turns with
 * the composite's own roll (degrees), so the fit moves in step with the drawn turn.
 */
function displayedFrame(
  availableWidth: number,
  availableHeight: number,
  scale: number,
  rotation: number,
) {
  const turned = Math.abs(Math.sin((rotation * Math.PI) / 180));
  const extentWidth = EXTENT.width + (EXTENT.height - EXTENT.width) * turned;
  const extentHeight = EXTENT.height + (EXTENT.width - EXTENT.height) * turned;
  const fitted = Math.min(availableWidth / extentWidth, availableHeight / extentHeight);
  return fitted * Math.min(1, scale);
}

/**
 * Square output side, in device pixels, that maps 1:1 onto the displayed device in
 * either orientation, so a Rotate never resizes the encoder mid-turn.
 */
export function duoOutputSide(
  availableWidth: number,
  availableHeight: number,
  scale: number,
  pixelRatio: number,
): number {
  const portrait = displayedFrame(availableWidth, availableHeight, scale, 0);
  const landscape = displayedFrame(availableWidth, availableHeight, scale, 90);
  return Math.ceil(Math.max(portrait, landscape) * pixelRatio);
}

export function duoViewport(
  bounds: number[],
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
  scale = 1,
  rotation = 0,
) {
  const x = Math.max(0, Math.floor(bounds[0]! * width)),
    y = Math.max(0, Math.floor(bounds[1]! * height));
  const right = Math.min(width, Math.ceil((bounds[0]! + bounds[2]!) * width));
  const bottom = Math.min(height, Math.ceil((bounds[1]! + bounds[3]!) * height));
  const crop = { x, y, width: right - x, height: bottom - y };
  const displayScale =
    displayedFrame(availableWidth, availableHeight, scale, rotation) / Math.max(width, height);
  return { crop, width: crop.width * displayScale, height: crop.height * displayScale };
}
