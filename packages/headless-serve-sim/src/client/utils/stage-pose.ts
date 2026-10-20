import { spring } from "../lib/motion";

/** Where the visible device sits on the stage, and how it is turned (degrees, clockwise). */
export interface StagePose {
  rotation: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Where the screen sits, when it isn't the whole box (a bezel around it). */
  screen?: { cx: number; cy: number; width: number };
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

/**
 * The offset to draw a resized device with (same turn, new size or place) so
 * its screen still sits exactly where the old screen is drawn. The screen is
 * what carries across — the bezel fades in or out around it — so the picture
 * never jumps. The turning element scales about the device box's centre.
 */
export function resizeStart(
  prev: StagePose,
  next: StagePose,
  drawn: TurnOffsets = AT_REST,
): TurnOffsets {
  const screenOf = (pose: StagePose) =>
    pose.screen ?? { cx: pose.cx, cy: pose.cy, width: pose.width };
  const from = screenOf(prev);
  const to = screenOf(next);
  const scale = (from.width * drawn.scale) / to.width;
  return {
    rotate: drawn.rotate,
    scale,
    x: prev.cx + drawn.scale * (from.cx - prev.cx) + drawn.x - next.cx - scale * (to.cx - next.cx),
    y: prev.cy + drawn.scale * (from.cy - prev.cy) + drawn.y - next.cy - scale * (to.cy - next.cy),
    lift: prev.cy + prev.height / 2 + drawn.lift - (next.cy + next.height / 2),
    footprint: (prev.width * drawn.footprint) / next.width,
  };
}

/**
 * The spring a turn springs back to rest on. From rest it lands with a touch
 * of settle, a half turn a little slower than a quarter. Picked up mid-turn
 * (`lastFrame`: the frame its start was read from) it keeps the device's
 * speed: Motion's timed springs drop it, so this uses the response and damping
 * spring.rotate stands for, and starts its clock at that frame so the time up
 * to the click isn't lost.
 */
export function turnTransition(rotate: number, lastFrame: number | null) {
  const { restDelta, restSpeed } = spring.rotate;
  if (lastFrame === null)
    return {
      ...spring.rotate,
      visualDuration: spring.rotate.visualDuration * Math.sqrt(Math.max(Math.abs(rotate), 90) / 90),
    };
  const response = (2 * Math.PI) / 0.4;
  return {
    type: "spring" as const,
    stiffness: response ** 2,
    damping: 2 * 0.8 * response,
    restDelta,
    restSpeed,
    startTime: lastFrame,
  };
}
