/** Longest the appearance reveal waits for the stream to repaint. */
export const REVEAL_FALLBACK_MS = 1000;

/** Side of the grid the stream is sampled into each frame. */
export const SCREEN_SAMPLE_SIZE = 16;

// A pixel counts as changed past this luminance step (encoder noise and
// antialiasing stay well under it), and the screen as changed once this share
// of pixels has — a clock tick or a spinner never reaches it, a light ⇄ dark
// repaint passes it in its first frame.
const PIXEL_STEP = 40;
const CHANGED_SHARE = 0.25;

/** One luminance per pixel of an RGBA buffer (from `getImageData`). */
export function luminanceGrid(data: Uint8ClampedArray): Float32Array {
  const grid = new Float32Array(data.length / 4);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
  }
  return grid;
}

/** Whether `next` reads as a different screen from `base`, not the same one moving. */
export function screenChanged(base: Float32Array, next: Float32Array): boolean {
  if (base.length === 0 || base.length !== next.length) return false;
  let changed = 0;
  for (let i = 0; i < base.length; i++) {
    if (Math.abs(base[i]! - next[i]!) > PIXEL_STEP) changed++;
  }
  return changed / base.length >= CHANGED_SHARE;
}

/** The reveal starts on the first repainted frame, or at the fallback. */
export function revealShouldStart({
  changed,
  elapsedMs,
}: {
  changed: boolean;
  elapsedMs: number;
}): boolean {
  return changed || elapsedMs >= REVEAL_FALLBACK_MS;
}
