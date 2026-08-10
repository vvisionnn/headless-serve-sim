import { describe, expect, test } from "bun:test";
import { rawDeltaForDisplayDelta, rawPointForDisplayPoint } from "../simulator/orientation";
import { wheelDeltaToPixels } from "../simulator/scroll-wheel";
import { WHEEL_LINE_HEIGHT_PX } from "../simulator/digitalCrown";

describe("wheelDeltaToPixels", () => {
  test("pixel-mode deltas pass through", () => {
    expect(wheelDeltaToPixels(120, 0, 800)).toBe(120);
    expect(wheelDeltaToPixels(-40, 0, 800)).toBe(-40);
  });

  test("line-mode deltas scale by the line height", () => {
    expect(wheelDeltaToPixels(3, 1, 800)).toBe(3 * WHEEL_LINE_HEIGHT_PX);
  });

  test("page-mode deltas scale by the axis length", () => {
    expect(wheelDeltaToPixels(2, 2, 800)).toBe(1600);
  });

  test("a non-finite delta contributes nothing", () => {
    expect(wheelDeltaToPixels(Number.NaN, 0, 800)).toBe(0);
    expect(wheelDeltaToPixels(Number.POSITIVE_INFINITY, 0, 800)).toBe(0);
  });

  test("a degenerate axis length can't turn a page delta into NaN or 0", () => {
    // Guards the divide-by-zero shape: an unmeasured element reports height 0.
    expect(wheelDeltaToPixels(2, 2, 0)).toBe(2);
    expect(wheelDeltaToPixels(2, 2, Number.NaN)).toBe(2);
  });
});

describe("rawDeltaForDisplayDelta", () => {
  test("portrait leaves the delta alone", () => {
    expect(rawDeltaForDisplayDelta("portrait", 3, 7)).toEqual({ dx: 3, dy: 7 });
    expect(rawDeltaForDisplayDelta(null, 3, 7)).toEqual({ dx: 3, dy: 7 });
  });

  test("upside down negates both axes", () => {
    expect(rawDeltaForDisplayDelta("portrait_upside_down", 3, 7)).toEqual({ dx: -3, dy: -7 });
  });

  test("landscape rotates the vector a quarter turn each way", () => {
    expect(rawDeltaForDisplayDelta("landscape_left", 3, 7)).toEqual({ dx: 7, dy: -3 });
    expect(rawDeltaForDisplayDelta("landscape_right", 3, 7)).toEqual({ dx: -7, dy: 3 });
  });

  test("the two landscape rotations are inverses of each other", () => {
    const once = rawDeltaForDisplayDelta("landscape_left", 3, 7);
    const back = rawDeltaForDisplayDelta("landscape_right", once.dx, once.dy);
    expect(back).toEqual({ dx: 3, dy: 7 });
  });

  test("rotation preserves magnitude", () => {
    const magnitude = (d: { dx: number; dy: number }) => Math.hypot(d.dx, d.dy);
    const source = { dx: 3, dy: 4 };
    for (const orientation of [
      "portrait",
      "portrait_upside_down",
      "landscape_left",
      "landscape_right",
    ] as const) {
      expect(magnitude(rawDeltaForDisplayDelta(orientation, source.dx, source.dy))).toBeCloseTo(5);
    }
  });

  // A delta is a free vector: rotating it must use only the linear part of the
  // point transform, with no translation. Verify against the point transform by
  // differencing two mapped points — if the two ever disagree, a scroll on a
  // rotated device travels the wrong way.
  test("matches the point transform differenced over two points", () => {
    for (const orientation of [
      "portrait",
      "portrait_upside_down",
      "landscape_left",
      "landscape_right",
    ] as const) {
      const from = { x: 0.2, y: 0.3 };
      const to = { x: 0.5, y: 0.9 };
      const mappedFrom = rawPointForDisplayPoint(orientation, from.x, from.y);
      const mappedTo = rawPointForDisplayPoint(orientation, to.x, to.y);
      const differenced = { dx: mappedTo.x - mappedFrom.x, dy: mappedTo.y - mappedFrom.y };
      const rotated = rawDeltaForDisplayDelta(orientation, to.x - from.x, to.y - from.y);
      expect(rotated.dx).toBeCloseTo(differenced.dx);
      expect(rotated.dy).toBeCloseTo(differenced.dy);
    }
  });
});
