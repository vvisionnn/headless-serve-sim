/**
 * The box that fits the stream's aspect inside the viewport, in CSS rather
 * than measured pixels: container units resolve on the same frame the viewport
 * changes, where a ResizeObserver reports a frame late and the picture would
 * lag the bezel around it. The viewport must be a size container.
 */
export function containedStreamBox(display: { width: number; height: number } | null): {
  width: string;
  height: string;
} {
  if (!display?.width || !display.height) return { width: "100%", height: "100%" };
  const { width, height } = display;
  return {
    width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
    height: `min(100cqh, calc(100cqw * ${height} / ${width}))`,
  };
}
