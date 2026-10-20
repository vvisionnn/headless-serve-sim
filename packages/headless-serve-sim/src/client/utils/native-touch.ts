/**
 * The native touchscreen (iPad) only takes points on the screen, but a drag
 * that leaves the stream keeps reporting beyond 0..1. Hold the finger on the
 * edge instead, so the gesture still moves and, above all, still lifts.
 */
export function nativeTouchPoint(point: { x: number; y: number }) {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(point.x), y: clamp(point.y) };
}
