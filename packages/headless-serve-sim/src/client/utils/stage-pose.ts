/** Where the visible device sits on the stage, and how it is turned (degrees, clockwise). */
export interface StagePose {
  rotation: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * The offset to draw a newly rotated device with so it still looks exactly
 * like the old one — same angle, size and place. Springing these back to rest
 * turns the device on the stage instead of swapping it. `lift` moves what
 * hangs under the device (dock, shadow) from the old bottom edge to the new;
 * `footprint` starts the contact shadow as wide as the old device rested.
 */
export function rotationStart(prev: StagePose, next: StagePose) {
  const turn = ((((prev.rotation - next.rotation) % 360) + 540) % 360) - 180;
  const quarter = Math.abs(turn) === 90;
  return {
    rotate: turn,
    scale: quarter ? prev.width / next.height : prev.width / next.width,
    x: prev.cx - next.cx,
    y: prev.cy - next.cy,
    lift: prev.cy + prev.height / 2 - (next.cy + next.height / 2),
    footprint: prev.width / next.width,
  };
}
