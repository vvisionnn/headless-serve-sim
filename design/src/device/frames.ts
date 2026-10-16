import type { DeviceKind } from "../lib/mock";

/** Shape of the device-frame spec the server ships (see device-frame-spec.ts). */
export interface Asset {
  pngDataUrl: string;
  width: number;
  height: number;
}
export interface Control {
  name: string;
  image: Asset;
  onTop: boolean;
  anchor: "left" | "right" | "top" | "bottom";
  align: "leading" | "center" | "trailing";
  normalOffsetPx: { x: number; y: number };
  rolloverOffsetPx: { x: number; y: number };
}
export interface FrameSpec {
  modelName: string;
  nativeScreen: { width: number; height: number };
  insetsPx: { top: number; right: number; bottom: number; left: number };
  screenRadiiPx: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  cutout: string;
  artwork: {
    width: number;
    height: number;
    chromeRectPx: { x: number; y: number; width: number; height: number };
    slices: Record<"topLeft" | "top" | "topRight" | "right" | "bottomRight" | "bottom" | "bottomLeft" | "left", Asset>;
    controls: Control[];
  };
}

declare global {
  interface Window {
    DEVICE_FRAMES: Record<DeviceKind, FrameSpec>;
  }
}

export const frameFor = (kind: DeviceKind) => window.DEVICE_FRAMES[kind];

/** Screen size in points: what the mock screens are laid out in. */
export const pointScale: Record<DeviceKind, number> = { iphone: 3, ipad: 2, watch: 2 };

/* Geometry ported from src/client/device-frame-artwork.ts so the preview
   places every slice and button exactly where the shipped bezel does. */
export function restingOffset(c: Control) {
  if (c.anchor === "left") return c.rolloverOffsetPx;
  return { x: 2 * c.normalOffsetPx.x - c.rolloverOffsetPx.x, y: 2 * c.normalOffsetPx.y - c.rolloverOffsetPx.y };
}

export function hoverOffset(c: Control) {
  const rest = restingOffset(c);
  const t =
    0.25 *
    Math.abs(c.anchor === "left" || c.anchor === "right" ? c.normalOffsetPx.x - c.rolloverOffsetPx.x : c.normalOffsetPx.y - c.rolloverOffsetPx.y);
  switch (c.anchor) {
    case "left":
      return { x: rest.x - t, y: rest.y };
    case "right":
      return { x: rest.x + t, y: rest.y };
    case "top":
      return { x: rest.x, y: rest.y - t };
    default:
      return { x: rest.x, y: rest.y + t };
  }
}

export function controlRect(c: Control, spec: FrameSpec, offset: { x: number; y: number }) {
  const chrome = spec.artwork.chromeRectPx;
  const img = c.image;
  if (c.anchor === "left") return { x: chrome.x + offset.x - img.width / 2, y: chrome.y + offset.y, width: img.width, height: img.height };
  if (c.anchor === "right") return { x: chrome.x + chrome.width + offset.x, y: chrome.y + offset.y, width: img.width, height: img.height };
  const x =
    c.align === "leading"
      ? chrome.x + offset.x
      : c.align === "trailing"
        ? chrome.x + chrome.width + offset.x - img.width
        : chrome.x + chrome.width / 2 + offset.x - img.width / 2;
  return { x, y: c.anchor === "top" ? chrome.y + offset.y - img.height : chrome.y + chrome.height + offset.y, width: img.width, height: img.height };
}

export function sliceRects(spec: FrameSpec) {
  const { chromeRectPx: c, slices: s } = spec.artwork;
  const right = c.x + c.width;
  const bottom = c.y + c.height;
  return [
    [s.topLeft, { x: c.x, y: c.y, width: s.topLeft.width, height: s.topLeft.height }],
    [s.top, { x: c.x + s.topLeft.width, y: c.y, width: c.width - s.topLeft.width - s.topRight.width, height: s.top.height }],
    [s.topRight, { x: right - s.topRight.width, y: c.y, width: s.topRight.width, height: s.topRight.height }],
    [s.right, { x: right - s.right.width, y: c.y + s.topRight.height, width: s.right.width, height: c.height - s.topRight.height - s.bottomRight.height }],
    [s.bottomRight, { x: right - s.bottomRight.width, y: bottom - s.bottomRight.height, width: s.bottomRight.width, height: s.bottomRight.height }],
    [s.bottom, { x: c.x + s.bottomLeft.width, y: bottom - s.bottom.height, width: c.width - s.bottomLeft.width - s.bottomRight.width, height: s.bottom.height }],
    [s.bottomLeft, { x: c.x, y: bottom - s.bottomLeft.height, width: s.bottomLeft.width, height: s.bottomLeft.height }],
    [s.left, { x: c.x, y: c.y + s.topLeft.height, width: s.left.width, height: c.height - s.topLeft.height - s.bottomLeft.height }],
  ] as const;
}
