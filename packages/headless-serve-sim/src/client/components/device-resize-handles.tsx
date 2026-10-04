import { useEffect, useRef } from "react";
import {
  startDeviceResize,
  type DeviceResizeHandle,
  type DeviceResizeSize,
} from "../utils/device-resize";

const handles: { handle: DeviceResizeHandle; className: string }[] = [
  { handle: "n", className: "left-0 right-0 -top-3 h-3 cursor-ns-resize" },
  { handle: "ne", className: "-right-3 -top-3 size-3 cursor-nesw-resize" },
  { handle: "e", className: "top-0 bottom-0 -right-3 w-3 cursor-ew-resize" },
  { handle: "se", className: "-right-3 -bottom-3 size-3 cursor-nwse-resize" },
  { handle: "s", className: "left-0 right-0 -bottom-3 h-3 cursor-ns-resize" },
  { handle: "sw", className: "-left-3 -bottom-3 size-3 cursor-nesw-resize" },
  { handle: "w", className: "top-0 bottom-0 -left-3 w-3 cursor-ew-resize" },
  { handle: "nw", className: "-left-3 -top-3 size-3 cursor-nwse-resize" },
];

// Overlay a relative wrapper around the whole frame, including its side buttons.
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
  changeRef.current = onScaleChange;
  useEffect(
    () => () => cleanupRef.current?.(),
    [fittedSize.width, fittedSize.height, availableSize.width, availableSize.height],
  );
  return (
    <div
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
      {handles.map(({ handle, className }) => (
        <div
          key={handle}
          data-device-resize-handle={handle}
          className={`pointer-events-auto absolute touch-none select-none ${className}`}
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
