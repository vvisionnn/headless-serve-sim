import { useEffect, useRef } from "react";
import {
  startDeviceResize,
  type DeviceResizeHandle,
  type DeviceResizeSize,
} from "../utils/device-resize";

const handles: DeviceResizeHandle[] = ["e", "s", "w"];

export function DeviceResizeHandles({
  fittedSize,
  availableSize,
  frameRect,
  scale,
  onScaleChange,
}: {
  fittedSize: DeviceResizeSize;
  availableSize: DeviceResizeSize;
  frameRect?: DeviceResizeSize & { x: number; y: number };
  scale: number;
  onScaleChange: (scale: number) => void;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const changeRef = useRef(onScaleChange);
  const containerRef = useRef<HTMLDivElement | null>(null);
  changeRef.current = onScaleChange;
  useEffect(() => {
    const reveal = (event: PointerEvent) => {
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const nearY = event.clientY >= rect.top && event.clientY <= rect.bottom;
      const nearX = event.clientX >= rect.left && event.clientX <= rect.right;
      element.dataset.near =
        nearY && Math.abs(event.clientX - rect.left) <= 24
          ? "w"
          : nearY && Math.abs(event.clientX - rect.right) <= 24
            ? "e"
            : nearX && Math.abs(event.clientY - rect.bottom) <= 24
              ? "s"
              : "";
    };
    window.addEventListener("pointermove", reveal);
    return () => window.removeEventListener("pointermove", reveal);
  }, []);
  useEffect(
    () => () => cleanupRef.current?.(),
    [fittedSize.width, fittedSize.height, availableSize.width, availableSize.height],
  );
  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none absolute z-20 ${frameRect ? "" : "inset-0"}`}
      style={
        frameRect
          ? {
              left: frameRect.x,
              top: frameRect.y,
              width: frameRect.width,
              height: frameRect.height,
            }
          : undefined
      }
    >
      {handles.map((handle) => (
        <div
          key={handle}
          data-device-resize-handle={handle}
          data-device-resize-grabber={handle}
          className={`device-resize-grabber pointer-events-auto absolute touch-none select-none rounded-sm bg-fg-2 ${
            handle === "s"
              ? "left-1/2 -bottom-3 h-1 w-8 -translate-x-1/2 cursor-ns-resize"
              : "top-1/2 h-8 w-1 -translate-y-1/2 cursor-ew-resize" +
                (handle === "w" ? " -left-3" : " -right-3")
          }`}
          onPointerDown={(event) => {
            if (!event.isPrimary) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            cleanupRef.current?.();
            cleanupRef.current = startDeviceResize(event, {
              handle,
              fittedSize,
              availableSize,
              scale,
              onScaleChange: (next) => changeRef.current(next),
            });
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      ))}
    </div>
  );
}
