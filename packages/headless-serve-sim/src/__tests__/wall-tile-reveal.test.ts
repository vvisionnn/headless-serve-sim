import { describe, expect, test } from "bun:test";
import {
  WALL_TILE_FRAME_CAP_MS,
  WALL_TILE_REVEAL_CAP_MS,
  stillFitsScreen,
  wallTileReady,
  wallTileRevealCap,
} from "../client/utils/wall-tile-reveal";

const ready = {
  specLoaded: true,
  needsArtwork: true,
  artworkReady: true,
  live: true,
  frameReady: true,
};

describe("wallTileReady", () => {
  test("a live tile waits for its spec, its artwork and its first frame", () => {
    expect(wallTileReady(ready)).toBe(true);
    expect(wallTileReady({ ...ready, specLoaded: false })).toBe(false);
    expect(wallTileReady({ ...ready, artworkReady: false })).toBe(false);
    expect(wallTileReady({ ...ready, frameReady: false })).toBe(false);
  });

  test("parts a tile doesn't draw don't hold it back", () => {
    // A booted tile that isn't streaming never gets a frame.
    expect(wallTileReady({ ...ready, live: false, frameReady: false })).toBe(true);
    // A profile without artwork (or a Duo, which streams its own body) has none to wait for.
    expect(wallTileReady({ ...ready, needsArtwork: false, artworkReady: false })).toBe(true);
  });
});

describe("a held still", () => {
  test("stands in for a live tile's first frame", () => {
    expect(wallTileReady({ ...ready, frameReady: false, stillReady: true })).toBe(true);
  });

  test("a live tile with no picture yet waits longer before it shows a black screen", () => {
    expect(wallTileRevealCap({ live: true, stillReady: false })).toBe(WALL_TILE_FRAME_CAP_MS);
    expect(WALL_TILE_FRAME_CAP_MS).toBeGreaterThan(WALL_TILE_REVEAL_CAP_MS);
    // A still in hand, or nothing to stream, keeps the short cap.
    expect(wallTileRevealCap({ live: true, stillReady: true })).toBe(WALL_TILE_REVEAL_CAP_MS);
    expect(wallTileRevealCap({ live: false, stillReady: false })).toBe(WALL_TILE_REVEAL_CAP_MS);
  });

  test("only seeds a screen it fits: the stage's turned frame doesn't seed an upright tile", () => {
    expect(stillFitsScreen({ width: 390, height: 844 }, { width: 120, height: 260 })).toBe(true);
    expect(stillFitsScreen({ width: 844, height: 390 }, { width: 120, height: 260 })).toBe(false);
    expect(stillFitsScreen({ width: 0, height: 0 }, { width: 120, height: 260 })).toBe(false);
  });
});
