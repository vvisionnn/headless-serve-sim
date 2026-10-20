export type DeviceResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface DeviceResizeSize {
  width: number;
  height: number;
}

export interface DeviceResizeOptions {
  handle: DeviceResizeHandle;
  fittedSize: DeviceResizeSize;
  availableSize: DeviceResizeSize;
  scale: number;
  maxScale?: number;
  onScaleChange: (scale: number) => void;
}

export function startDeviceResize(
  event: Pick<
    PointerEvent,
    "button" | "pointerId" | "clientX" | "clientY" | "preventDefault" | "stopPropagation"
  > & {
    currentTarget: HTMLElement;
  },
  options: DeviceResizeOptions,
): () => void {
  event.preventDefault();
  event.stopPropagation();
  if (event.button !== 0) return () => {};
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  let frame: number | null = null;
  let latestScale = options.scale;
  let emittedScale = options.scale;
  const emit = () => {
    frame = null;
    if (latestScale === emittedScale) return;
    emittedScale = latestScale;
    options.onScaleChange(latestScale);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    latestScale = getDeviceResizeScale({
      ...options,
      startScale: options.scale,
      deltaX: e.clientX - event.clientX,
      deltaY: e.clientY - event.clientY,
    });
    if (frame === null) frame = requestAnimationFrame(emit);
  };
  const dispose = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("lostpointercapture", cancel);
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    move(e);
    if (frame !== null) cancelAnimationFrame(frame);
    emit();
    dispose();
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    dispose();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("lostpointercapture", cancel);
  return dispose;
}

export function getDeviceResizeScale(p: {
  handle: DeviceResizeHandle;
  fittedSize: DeviceResizeSize;
  availableSize: DeviceResizeSize;
  startScale: number;
  maxScale?: number;
  deltaX: number;
  deltaY: number;
}): number {
  const { width, height } = p.fittedSize;
  if (width <= 0 || height <= 0) return 0;
  const x = p.handle.includes("e") ? 1 : p.handle.includes("w") ? -1 : 0;
  const y = p.handle.includes("s") ? 1 : p.handle.includes("n") ? -1 : 0;
  // The frame stays centered; project corner movement onto its aspect diagonal.
  const delta =
    x && y
      ? (2 * (x * p.deltaX * width + y * p.deltaY * height)) / (width * width + height * height)
      : x
        ? (2 * x * p.deltaX) / width
        : (2 * y * p.deltaY) / height;
  const max = Math.min(
    2,
    p.maxScale ?? 2,
    p.availableSize.width / width,
    p.availableSize.height / height,
  );
  const min = Math.min(0.25, max);
  const startScale = Math.max(min, Math.min(max, p.startScale));
  return Math.max(min, Math.min(max, startScale + delta));
}
