/**
 * Where a tile lays the glass's own picture (the stream, always the portrait
 * buffer) inside a screen drawn turned with the device: a box of the glass's
 * shape, centred in the screen and turned by the device's rotation — what the
 * stage does, so the tile and the device it flies into look the same.
 */
export function unturnedScreenBox(screen: { width: number; height: number }, rotation: number) {
  const sideways = Math.abs(rotation) === 90;
  const width = sideways ? screen.height : screen.width;
  const height = sideways ? screen.width : screen.height;
  return {
    left: (screen.width - width) / 2,
    top: (screen.height - height) / 2,
    width,
    height,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };
}
