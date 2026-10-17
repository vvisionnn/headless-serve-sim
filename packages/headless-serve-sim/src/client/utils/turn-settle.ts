/**
 * Decides when iOS has finished redrawing after a turn: once the device turn
 * has had time to land (`minMs`) and the screen has stopped changing for
 * `stillMs`, or at `maxMs` regardless. Feed it a small sample of the screen
 * each frame; `null` (nothing to sample) counts as unchanged.
 */
export function createSettleWatch({
  minMs,
  stillMs,
  maxMs,
}: {
  minMs: number;
  stillMs: number;
  maxMs: number;
}) {
  let start: number | null = null;
  let lastChange = 0;
  let last: Uint8ClampedArray | null = null;
  return (now: number, sample: Uint8ClampedArray | null): boolean => {
    if (start === null) {
      start = lastChange = now;
      last = sample;
      return false;
    }
    if (!samePixels(last, sample)) lastChange = now;
    last = sample;
    const elapsed = now - start;
    return elapsed >= maxMs || (elapsed >= minMs && now - lastChange >= stillMs);
  };
}

function samePixels(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
