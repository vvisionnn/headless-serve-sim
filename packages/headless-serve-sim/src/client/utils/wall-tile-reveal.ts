/** Longest a wall tile waits for its parts before it shows anyway. */
export const WALL_TILE_REVEAL_CAP_MS = 300;
/**
 * Longest a live tile with no picture yet waits. A stream's first frame
 * takes 400–500ms on the first open after a load; showing the tile at the
 * short cap would fade in a black screen that lights up a beat later.
 */
export const WALL_TILE_FRAME_CAP_MS = 1200;

/**
 * A wall tile shows once everything it draws is in — its real bezel (spec and
 * composited artwork) and, when live, a picture: its first stream frame, or
 * a still held until then — so it never arrives as a black rim that then
 * pops into a device.
 */
export function wallTileReady(parts: {
  specLoaded: boolean;
  needsArtwork: boolean;
  artworkReady: boolean;
  live: boolean;
  frameReady: boolean;
  stillReady?: boolean;
}): boolean {
  return (
    parts.specLoaded &&
    (!parts.needsArtwork || parts.artworkReady) &&
    (!parts.live || parts.frameReady || !!parts.stillReady)
  );
}

/** How long a tile may wait for its parts: longer while its only picture is still to come. */
export function wallTileRevealCap(parts: { live: boolean; stillReady: boolean }): number {
  return parts.live && !parts.stillReady ? WALL_TILE_FRAME_CAP_MS : WALL_TILE_REVEAL_CAP_MS;
}

/**
 * Whether a still can stand in for a tile's screen: the same shape, so the
 * stream that replaces it crossfades rather than turns (the stage may hold
 * its device sideways; a tile is always upright).
 */
export function stillFitsScreen(
  still: { width: number; height: number },
  screen: { width: number; height: number },
): boolean {
  if (!still.width || !still.height || !screen.width || !screen.height) return false;
  const ratio = still.width / still.height / (screen.width / screen.height);
  return ratio > 0.85 && ratio < 1.18;
}
