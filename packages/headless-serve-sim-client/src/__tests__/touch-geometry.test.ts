import { describe, expect, test } from "bun:test";
import { normalizedPoint, type NormPoint } from "../simulator/touch-geometry";

// A representative on-screen surface rect: 200px wide, 400px tall, offset into
// the viewport. Mirrors what getBoundingClientRect() returns for the device
// frame surface.
const RECT = { left: 100, top: 50, width: 200, height: 400 };

describe("normalizedPoint", () => {
  // ─── Core contract ───

  test("center of the rect maps to (0.5, 0.5)", () => {
    // center client point = left + width/2, top + height/2
    const p = normalizedPoint(100 + 100, 50 + 200, RECT);
    expect(p.x).toBe(0.5);
    expect(p.y).toBe(0.5);
  });

  test("top-left corner maps to (0, 0)", () => {
    const p = normalizedPoint(RECT.left, RECT.top, RECT);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  test("bottom-right corner maps to (1, 1)", () => {
    const p = normalizedPoint(RECT.left + RECT.width, RECT.top + RECT.height, RECT);
    expect(p.x).toBe(1);
    expect(p.y).toBe(1);
  });

  test("top-right corner maps to (1, 0)", () => {
    const p = normalizedPoint(RECT.left + RECT.width, RECT.top, RECT);
    expect(p.x).toBe(1);
    expect(p.y).toBe(0);
  });

  test("bottom-left corner maps to (0, 1)", () => {
    const p = normalizedPoint(RECT.left, RECT.top + RECT.height, RECT);
    expect(p.x).toBe(0);
    expect(p.y).toBe(1);
  });

  // ─── Non-zero offset: the subtraction of left/top matters ───

  test("rect offset is subtracted (a point at left/top is the origin, not raw)", () => {
    // With a heavily-offset rect, a client point equal to (left, top) must be
    // (0,0), not (left/width, top/height). Guards against dropping the offset.
    const offsetRect = { left: 640, top: 320, width: 160, height: 320 };
    const p = normalizedPoint(640, 320, offsetRect);
    expect(p).toEqual({ x: 0, y: 0 });
  });

  test("exact formula: (clientX-left)/width, (clientY-top)/height", () => {
    const p = normalizedPoint(150, 250, RECT);
    expect(p.x).toBeCloseTo((150 - 100) / 200, 12); // 0.25
    expect(p.y).toBeCloseTo((250 - 50) / 400, 12); // 0.5
  });

  // ─── Outside the rect: NOT clamped (callers rely on out-of-range values) ───

  test("point left of the rect yields negative x (not clamped to 0)", () => {
    const p = normalizedPoint(RECT.left - 40, RECT.top + 200, RECT);
    expect(p.x).toBe(-0.2);
    expect(p.x).toBeLessThan(0);
  });

  test("point above the rect yields negative y (not clamped to 0)", () => {
    const p = normalizedPoint(RECT.left + 100, RECT.top - 80, RECT);
    expect(p.y).toBe(-0.2);
    expect(p.y).toBeLessThan(0);
  });

  test("point right of the rect yields x > 1 (not clamped to 1)", () => {
    const p = normalizedPoint(RECT.left + RECT.width + 100, RECT.top, RECT);
    expect(p.x).toBe(1.5);
    expect(p.x).toBeGreaterThan(1);
  });

  test("point below the rect yields y > 1 (not clamped to 1)", () => {
    const p = normalizedPoint(RECT.left, RECT.top + RECT.height + 200, RECT);
    expect(p.y).toBe(1.5);
    expect(p.y).toBeGreaterThan(1);
  });

  // ─── DRIFT CONTRACT ───
  // The same viewport client point maps to DIFFERENT normalized coordinates
  // depending on the rect. This is why the rect must be read fresh per event:
  // a panel expand/collapse shifts the surface horizontally, and a cached rect
  // would silently drift the tap location. (The cache that drifted was reverted
  // precisely because of this property.)

  test("same client point + two different rects → different normalized x", () => {
    const clientX = 300;
    const clientY = 250;
    // Surface in its "panel collapsed" position…
    const rectA = { left: 100, top: 50, width: 200, height: 400 };
    // …then the inspector expands and shoves the surface 80px left.
    const rectB = { left: 180, top: 50, width: 200, height: 400 };

    const a = normalizedPoint(clientX, clientY, rectA);
    const b = normalizedPoint(clientX, clientY, rectB);

    expect(a.x).not.toBe(b.x);
    // y is unaffected because only `left` changed — proves it's the rect's x
    // origin driving the drift, not the whole mapping.
    expect(a.y).toBe(b.y);
    // Concretely: (300-100)/200 = 1.0 vs (300-180)/200 = 0.6
    expect(a.x).toBeCloseTo(1.0, 12);
    expect(b.x).toBeCloseTo(0.6, 12);
  });

  test("different rect WIDTH rescales the same client point", () => {
    const clientX = 200;
    const wide = { left: 100, top: 0, width: 400, height: 400 };
    const narrow = { left: 100, top: 0, width: 100, height: 400 };
    expect(normalizedPoint(clientX, 0, wide).x).toBeCloseTo(0.25, 12);
    expect(normalizedPoint(clientX, 0, narrow).x).toBeCloseTo(1.0, 12);
  });

  // ─── Degenerate rect (width/height 0) → division by zero ───
  // No guard exists (and none is wanted: a 0-size surface never receives a
  // real pointer event). Pin down what JS division actually produces so a
  // future "defensive clamp" change is a conscious decision, not a silent one.

  test("zero width: nonzero numerator → +Infinity", () => {
    const p = normalizedPoint(150, 100, { left: 100, top: 0, width: 0, height: 200 });
    expect(p.x).toBe(Infinity);
  });

  test("zero width: numerator exactly 0 → NaN (0/0)", () => {
    const p = normalizedPoint(100, 100, { left: 100, top: 0, width: 0, height: 200 });
    expect(p.x).toBeNaN();
  });

  test("zero width: negative numerator → -Infinity", () => {
    const p = normalizedPoint(50, 100, { left: 100, top: 0, width: 0, height: 200 });
    expect(p.x).toBe(-Infinity);
  });

  test("zero height: nonzero numerator → +Infinity, exact-top → NaN", () => {
    const rect = { left: 0, top: 50, width: 200, height: 0 };
    expect(normalizedPoint(0, 100, rect).y).toBe(Infinity);
    expect(normalizedPoint(0, 50, rect).y).toBeNaN();
  });

  // ─── Shape / purity ───

  test("returns a fresh NormPoint with exactly x and y", () => {
    const p: NormPoint = normalizedPoint(150, 250, RECT);
    expect(Object.keys(p).sort()).toEqual(["x", "y"]);
  });

  test("does not mutate the input rect", () => {
    const rect = { left: 10, top: 20, width: 100, height: 200 };
    const snapshot = { ...rect };
    normalizedPoint(60, 120, rect);
    expect(rect).toEqual(snapshot);
  });

  test("ignores extra rect fields (accepts a full DOMRect-like object)", () => {
    // getBoundingClientRect() returns right/bottom/x/y too; the util must only
    // read left/top/width/height.
    const domRectLike = {
      left: 100,
      top: 50,
      width: 200,
      height: 400,
      right: 300,
      bottom: 450,
      x: 100,
      y: 50,
    };
    const p = normalizedPoint(200, 250, domRectLike);
    expect(p).toEqual({ x: 0.5, y: 0.5 });
  });
});
