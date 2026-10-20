import { describe, expect, test } from "bun:test";
import {
  createClearanceTracker,
  TOAST_BOTTOM,
  toastPlacement,
} from "../client/utils/toast-placement";

const viewport = { width: 1280, height: 800 };

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The stack's box at a placement, in its tallest resting extent. */
function stackBox(right: number, placement: { bottom: number; width: number }): Box {
  return {
    left: viewport.width - right - placement.width,
    right: viewport.width - right,
    top: viewport.height - placement.bottom - 72,
    bottom: viewport.height - placement.bottom + 24, // a toast enters from 24px lower
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("toastPlacement", () => {
  test("rests at the window's corner when nothing is under it", () => {
    expect(toastPlacement({ viewport, right: 20, width: 320, dock: null, screens: [] })).toEqual({
      bottom: TOAST_BOTTOM,
      width: 320,
    });
  });

  test("lifts clear of a dock that reaches under the stack", () => {
    // 1280×800, inspector closed: the dock's right end sits in the toast column.
    const dock = { left: 450, right: 1000, top: 700, bottom: 750 };
    const placed = toastPlacement({ viewport, right: 20, width: 320, dock, screens: [] });
    expect(placed.width).toBe(320);
    // Clear even while a toast enters, rising from 24px lower.
    expect(placed.bottom - 24).toBeGreaterThan(800 - dock.top);
  });

  test("stays down when the dock is beside the stack, not under it", () => {
    const dock = { left: 300, right: 800, top: 700, bottom: 750 };
    expect(
      toastPlacement({
        viewport: { width: 1600, height: 800 },
        right: 20,
        width: 320,
        dock,
        screens: [],
      }).bottom,
    ).toBe(TOAST_BOTTOM);
  });

  test("stays down when the dock is above the stack's resting place", () => {
    const dock = { left: 900, right: 1200, top: 400, bottom: 450 };
    expect(toastPlacement({ viewport, right: 20, width: 320, dock, screens: [] }).bottom).toBe(
      TOAST_BOTTOM,
    );
  });

  test("never lifts over the live screen: it narrows beside the dock instead", () => {
    // 1280×800 with the inspector open: lifting above the dock would cover
    // the iPad screen's lower-right corner.
    const right = 358;
    const dock = { left: 312, right: 620, top: 724, bottom: 774 };
    const screen = { left: 242, right: 686, top: 90, bottom: 682 };
    const placed = toastPlacement({ viewport, right, width: 320, dock, screens: [screen] });
    const box = stackBox(right, placed);
    expect(overlaps(box, screen)).toBe(false);
    expect(overlaps(box, dock)).toBe(false);
    expect(placed.width).toBeGreaterThanOrEqual(200);
    expect(placed.width).toBeLessThan(320);
  });

  test("a wide window keeps the full stack in its corner", () => {
    const wide = { width: 1800, height: 1000 };
    const dock = { left: 560, right: 870, top: 924, bottom: 974 };
    const screen = { left: 400, right: 1000, top: 90, bottom: 880 };
    expect(
      toastPlacement({ viewport: wide, right: 358, width: 320, dock, screens: [screen] }),
    ).toEqual({ bottom: TOAST_BOTTOM, width: 320 });
  });

  test("a lifted stack that would cover the screen narrows beside it", () => {
    // The dock spans the whole column, so the stack must lift; the screen
    // reaches into the lifted spot's left side.
    const right = 20;
    const dock = { left: 600, right: 1270, top: 724, bottom: 774 };
    const screen = { left: 300, right: 980, top: 90, bottom: 690 };
    const placed = toastPlacement({ viewport, right, width: 320, dock, screens: [screen] });
    const box = stackBox(right, placed);
    expect(overlaps(box, screen)).toBe(false);
    expect(overlaps(box, dock)).toBe(false);
  });
});

describe("createClearanceTracker", () => {
  test("the first toast lands in place; later moves spring; a re-measure that agrees stays", () => {
    const tracker = createClearanceTracker();
    expect(tracker.reach(20)).toBe("jump");
    expect(tracker.reach(106)).toBe("spring");
    expect(tracker.reach(106)).toBe("stay");
  });

  test("keeps its target across re-measures (the inspector opening) while a toast shows", () => {
    const tracker = createClearanceTracker();
    tracker.reach(106);
    // The effect re-runs with a new `right`: no reset, so no jump.
    expect(tracker.reach(20)).toBe("spring");
  });

  test("jumps again only once the stack has emptied", () => {
    const tracker = createClearanceTracker();
    expect(tracker.placed).toBe(false);
    tracker.reach(106);
    expect(tracker.placed).toBe(true);
    tracker.reset();
    expect(tracker.placed).toBe(false);
    expect(tracker.reach(20)).toBe("jump");
  });
});
