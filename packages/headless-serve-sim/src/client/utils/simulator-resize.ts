export const SIMULATOR_RESIZE_MAX_SCALE = 3;

/** Round to whole device pixels so the frame / stream do not shimmer at sub-pixel widths. */
export function roundToDevicePixel(value: number): number {
  if (!Number.isFinite(value)) return value;
  const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
  return Math.round(value * dpr) / dpr;
}
