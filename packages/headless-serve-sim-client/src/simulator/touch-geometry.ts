export interface NormPoint {
  x: number;
  y: number;
}

/**
 * Map a viewport client point (e.g. `event.clientX/Y`) to normalized
 * screen-space coordinates within `rect`, where (0,0) is the rect's top-left
 * corner and (1,1) is the bottom-right.
 *
 * Not clamped: points outside the rect produce values < 0 or > 1, which the
 * callers rely on (a touch dragged past the frame edge keeps reporting beyond
 * 0..1 until the gesture ends).
 *
 * The `rect` MUST be the surface's CURRENT bounding rect, read fresh per event:
 * a panel expand/collapse shifts the frame without firing resize/scroll, so a
 * cached rect drifts the mapping. This is why the same client point yields a
 * different result against a different rect.
 */
export function normalizedPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): NormPoint {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  };
}
