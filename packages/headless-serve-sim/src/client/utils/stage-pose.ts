/** Where the visible device sits on the stage, and how it is turned (degrees, clockwise). */
export interface StagePose {
  rotation: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * How far a turning device is drawn from its rest pose: the turning element's
 * rotate/scale/x/y, `lift` for what hangs under the device (dock, shadow) and
 * `footprint` for the contact shadow's width.
 */
export interface TurnOffsets {
  rotate: number;
  scale: number;
  x: number;
  y: number;
  lift: number;
  footprint: number;
}

export const AT_REST: TurnOffsets = { rotate: 0, scale: 1, x: 0, y: 0, lift: 0, footprint: 1 };

/** The device's size held upright: a sideways pose swaps its sides back. */
export function unturnedSize({
  rotation,
  width,
  height,
}: Pick<StagePose, "rotation" | "width" | "height">) {
  return Math.abs(rotation) % 180 === 90 ? { width: height, height: width } : { width, height };
}

/**
 * The offset to draw a newly rotated device with so it still looks exactly
 * like the old one — same angle, size and place. Springing these back to rest
 * turns the device on the stage instead of swapping it. `drawn` is how far the
 * old one is still from its own rest, so a turn begun mid-turn picks the
 * device up where it is and goes the short way round from there.
 */
export function rotationStart(
  prev: StagePose,
  next: StagePose,
  drawn: TurnOffsets = AT_REST,
): TurnOffsets {
  const angle = prev.rotation + drawn.rotate - next.rotation;
  return {
    rotate: (((angle % 360) + 540) % 360) - 180,
    scale: (unturnedSize(prev).width * drawn.scale) / unturnedSize(next).width,
    x: prev.cx + drawn.x - next.cx,
    y: prev.cy + drawn.y - next.cy,
    lift: prev.cy + prev.height / 2 + drawn.lift - (next.cy + next.height / 2),
    footprint: (prev.width * drawn.footprint) / next.width,
  };
}
