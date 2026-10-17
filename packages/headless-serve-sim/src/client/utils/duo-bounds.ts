export interface DuoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  fittedWidth: number;
  fittedHeight: number;
}

/** Sub-pixel jitter from the per-frame paint isn't a move worth re-rendering for. */
export function sameDuoBounds(a: DuoBounds, b: DuoBounds): boolean {
  return (Object.keys(a) as (keyof DuoBounds)[]).every((k) => Math.abs(a[k] - b[k]) < 0.5);
}
