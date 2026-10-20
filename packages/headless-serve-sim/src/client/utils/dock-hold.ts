/** How long a press keeps the dock where it was pressed, for a touch with no hover. */
export const DOCK_HOLD_MS = 700;

/**
 * How much longer the dock stays put under the pointer instead of following
 * the device (ms): for as long as the pointer is over it, and a beat after a
 * press — so a second press lands where the first one did.
 */
export function dockHoldLeft(hovered: boolean, pressedAt: number, now: number): number {
  if (hovered) return Infinity;
  return Math.max(0, pressedAt + DOCK_HOLD_MS - now);
}
