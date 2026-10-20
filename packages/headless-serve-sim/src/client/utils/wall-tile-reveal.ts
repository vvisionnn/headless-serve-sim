/** Longest a wall tile waits for its parts before it shows anyway. */
export const WALL_TILE_REVEAL_CAP_MS = 300;

/**
 * A wall tile shows once everything it draws is in — its real bezel (spec and
 * composited artwork) and, when live, a first stream frame — so it never
 * arrives as a black rim that then pops into a device.
 */
export function wallTileReady(parts: {
  specLoaded: boolean;
  needsArtwork: boolean;
  artworkReady: boolean;
  live: boolean;
  frameReady: boolean;
}): boolean {
  return (
    parts.specLoaded &&
    (!parts.needsArtwork || parts.artworkReady) &&
    (!parts.live || parts.frameReady)
  );
}
