/** The stack's resting distance from the window's bottom edge. */
export const TOAST_BOTTOM = 20;

// Room a single toast takes above its bottom edge, and the gap kept over the
// dock — wider than the 24px a toast rises from as it enters, so its first
// frames don't dip over the dock either.
const TOAST_HEIGHT = 72;
const ENTER_RISE = 24;
const DOCK_GAP = 30;
// Narrowed to sit beside the dock or the screen, the stack keeps this gap
// from them and never gets narrower than MIN_WIDTH.
const SIDE_GAP = 16;
const MIN_WIDTH = 200;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Placement {
  bottom: number;
  width: number;
}

/**
 * Where the toast stack sits: the window's corner, unless the device dock or
 * a live screen reaches under it there. Then, in order: lifted just above
 * the dock; narrowed beside them in the corner; lifted and narrowed. A toast
 * never covers a dock control or the screen while one of those fits.
 */
export function toastPlacement({
  viewport,
  right,
  width,
  dock,
  screens,
}: {
  viewport: { width: number; height: number };
  right: number;
  width: number;
  dock: Box | null;
  screens: Box[];
}): Placement {
  const obstacles = dock ? [dock, ...screens] : screens;
  const stackRight = viewport.width - right;
  // Everything under a stack whose bottom edge sits `bottom` up, `w` wide —
  // including the 24px below it a toast enters from.
  const under = (bottom: number, w: number) => {
    const top = viewport.height - bottom - TOAST_HEIGHT;
    const low = viewport.height - bottom + ENTER_RISE;
    return obstacles.filter(
      (o) => o.right > stackRight - w && o.left < stackRight && o.bottom > top && o.top < low,
    );
  };
  // The widest stack that clears everything under it by sitting to its right.
  const beside = (bottom: number): Placement | null => {
    const blockers = under(bottom, width);
    const edge = Math.max(...blockers.map((o) => o.right));
    const narrowed = Math.min(width, Math.floor(stackRight - edge - SIDE_GAP));
    return narrowed >= MIN_WIDTH ? { bottom, width: narrowed } : null;
  };

  if (under(TOAST_BOTTOM, width).length === 0) return { bottom: TOAST_BOTTOM, width };
  const lifted = dock
    ? Math.max(TOAST_BOTTOM, Math.ceil(viewport.height - dock.top + DOCK_GAP))
    : TOAST_BOTTOM;
  if (under(lifted, width).length === 0) return { bottom: lifted, width };
  return beside(TOAST_BOTTOM) ?? beside(lifted) ?? { bottom: lifted, width };
}

/**
 * How the stack reaches each newly measured place: the first toast lands in
 * place (the empty stack jumps there before it paints); after that it
 * springs. The held target outlives re-measures — the inspector opening, the
 * dock moving — and is let go only once the stack has emptied.
 */
export function createClearanceTracker() {
  let target: number | null = null;
  return {
    reach(next: number): "jump" | "spring" | "stay" {
      const move = target === null ? "jump" : next === target ? "stay" : "spring";
      target = next;
      return move;
    },
    reset() {
      target = null;
    },
  };
}
