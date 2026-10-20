// Long enough for iOS to finish the turn we asked for.
const OWN_TURN_MS = 1500;

/**
 * Whether to read back how the device is held after the app's orientation
 * moved. Not for a turn we just commanded: we already know where it is, and
 * the read spawns devicectl, which stalls the simulator's frames while iOS is
 * still animating — the picture freezes tilted, then snaps.
 */
export function confirmsOrientation(now: number, commandedAt: number): boolean {
  return now - commandedAt >= OWN_TURN_MS;
}
