/** The stack's resting distance from the window's bottom edge. */
export const TOAST_BOTTOM = 20;

// Room a single toast takes above its bottom edge, and the gap kept over the
// dock — wider than the 24px a toast rises from as it enters, so its first
// frames don't dip over the dock either.
const TOAST_HEIGHT = 72;
const DOCK_GAP = 30;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Distance from the window's bottom edge for the toast stack: the corner,
 * unless the device dock reaches under the stack there — then just above it,
 * so a toast never covers a dock control.
 */
export function toastBottom({
  viewport,
  right,
  width,
  dock,
}: {
  viewport: { width: number; height: number };
  right: number;
  width: number;
  dock: Box | null;
}): number {
  if (!dock) return TOAST_BOTTOM;
  const stackRight = viewport.width - right;
  const stackLeft = stackRight - width;
  const stackTop = viewport.height - TOAST_BOTTOM - TOAST_HEIGHT;
  const overlaps = dock.right > stackLeft && dock.left < stackRight && dock.bottom > stackTop;
  if (!overlaps) return TOAST_BOTTOM;
  return Math.max(TOAST_BOTTOM, Math.ceil(viewport.height - dock.top + DOCK_GAP));
}
