import { roundToDevicePixel } from "./simulator-resize";

/**
 * Fit the device frame inside the viewport, preserving aspect ratio so the
 * frame never clips and never slips under the side rails or top bar.
 *
 * Height-bound by default (top bar + frameH == viewport height for portrait);
 * clamp to width for wide devices; cap upscale (maxWidth * maxScale) so
 * low-res devices (watch / vision) don't balloon soft on large displays. The
 * assembly's outer border is reserved up front, and the result is rounded to
 * whole device pixels and floored at 0 so it stays non-negative at any size.
 */
export function fitDeviceFrame(p: {
  viewportWidth: number;
  viewportHeight: number;
  topBarHeight: number;
  sideRailsWidth: number;
  assemblyBorder: number;
  aspect: number;
  maxWidth: number;
  maxScale: number;
}): { width: number; height: number } {
  // Normalized to > 0 so the divisions below never hit a divide-by-zero.
  const aspect = p.aspect > 0 ? p.aspect : 1;
  const availH = Math.max(0, p.viewportHeight - p.topBarHeight - p.assemblyBorder);
  const availW = Math.max(0, p.viewportWidth - p.sideRailsWidth - p.assemblyBorder);
  let h = Math.min(availH, availW / aspect);
  let w = h * aspect;
  if (w > availW) {
    w = availW;
    h = w / aspect;
  }
  const upscaleCap = p.maxWidth * p.maxScale;
  if (w > upscaleCap) {
    w = upscaleCap;
    h = w / aspect;
  }
  return {
    width: Math.max(0, roundToDevicePixel(w)),
    height: Math.max(0, roundToDevicePixel(h)),
  };
}
