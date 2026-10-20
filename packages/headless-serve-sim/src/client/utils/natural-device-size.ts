/** CSS defines an inch as 96px; a device opens at its size in those inches. */
const CSS_PX_PER_INCH = 96;

/**
 * A device never opens closer than this to filling the stage, so there is room
 * to work around it.
 */
export const NATURAL_ROOM = 0.86;

/** CSS px per screen pixel for a device drawn at its real size. */
export function realSizeScale(spec: { screenPixelsPerInch?: number }): number | null {
  const ppi = spec.screenPixelsPerInch;
  return ppi && ppi > 0 ? CSS_PX_PER_INCH / ppi : null;
}

/**
 * The zoom, as a fraction of the size that fills the stage, a device opens at:
 * its real size, or less than filling the stage when that is too big.
 */
export function naturalZoom(realLength: number | null, fittedLength: number): number {
  if (!realLength || fittedLength <= 0) return NATURAL_ROOM;
  return Math.min(NATURAL_ROOM, realLength / fittedLength);
}

type ZoomStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const zoomKey = (model: string) => `serve-sim:device-zoom:${model}`;

/** The size a person chose for this device model, or null for its natural size. */
export function readDeviceZoom(storage: ZoomStorage | null, model: string | undefined) {
  if (!storage || !model) return null;
  try {
    const zoom = Number.parseFloat(storage.getItem(zoomKey(model)) ?? "");
    return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
  } catch {
    return null;
  }
}

/** Remember a chosen size; null goes back to the natural size. */
export function writeDeviceZoom(
  storage: ZoomStorage | null,
  model: string | undefined,
  zoom: number | null,
): void {
  if (!storage || !model) return;
  try {
    if (zoom === null) storage.removeItem(zoomKey(model));
    else storage.setItem(zoomKey(model), String(zoom));
  } catch {}
}
