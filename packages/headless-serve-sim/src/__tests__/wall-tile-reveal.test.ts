import { describe, expect, test } from "bun:test";
import { wallTileReady } from "../client/utils/wall-tile-reveal";

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
