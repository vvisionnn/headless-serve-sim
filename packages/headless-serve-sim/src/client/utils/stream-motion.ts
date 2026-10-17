const SIDE = 16;

/** True when enough of the picture changed to be motion rather than encoder noise. */
export function framesDiffer(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i]! - b[i]!) > 24 ||
      Math.abs(a[i + 1]! - b[i + 1]!) > 24 ||
      Math.abs(a[i + 2]! - b[i + 2]!) > 24
    )
      changed++;
  }
  return changed > (a.length / 4) * 0.02;
}

/**
 * Calls `onMove` once the stream inside `container` starts to change (iOS
 * beginning its rotation), or after `capMs` if it never does. Returns a
 * cancel function.
 */
export function whenStreamMoves(
  container: HTMLElement | null,
  capMs: number,
  onMove: () => void,
): () => void {
  const probe = document.createElement("canvas");
  probe.width = probe.height = SIDE;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  const sample = (): Uint8ClampedArray | null => {
    const stream = container?.querySelector<HTMLCanvasElement | HTMLVideoElement>("canvas, video");
    if (!ctx || !stream) return null;
    try {
      ctx.drawImage(stream, 0, 0, SIDE, SIDE);
      return ctx.getImageData(0, 0, SIDE, SIDE).data;
    } catch {
      return null;
    }
  };
  const before = sample();
  const started = performance.now();
  let raf = requestAnimationFrame(function watch(now) {
    if (now - started >= capMs || framesDiffer(before, sample())) onMove();
    else raf = requestAnimationFrame(watch);
  });
  return () => cancelAnimationFrame(raf);
}
