import { describe, expect, test } from "bun:test";
import { TOAST_BOTTOM, toastBottom } from "../client/utils/toast-placement";

const viewport = { width: 1280, height: 800 };

describe("toastBottom", () => {
  test("rests at the window's corner when nothing is under it", () => {
    expect(toastBottom({ viewport, right: 20, width: 320, dock: null })).toBe(TOAST_BOTTOM);
  });

  test("lifts clear of a dock that reaches under the stack", () => {
    // 1280×800, inspector closed: the dock's right end sits in the toast column.
    const dock = { left: 450, right: 1000, top: 700, bottom: 750 };
    const bottom = toastBottom({ viewport, right: 20, width: 320, dock });
    // Clear even while a toast enters, rising from 24px lower.
    expect(bottom - 24).toBeGreaterThan(800 - dock.top);
  });

  test("stays down when the dock is beside the stack, not under it", () => {
    const dock = { left: 300, right: 800, top: 700, bottom: 750 };
    expect(
      toastBottom({ viewport: { width: 1600, height: 800 }, right: 20, width: 320, dock }),
    ).toBe(TOAST_BOTTOM);
  });

  test("stays down when the dock is above the stack's resting place", () => {
    const dock = { left: 900, right: 1200, top: 400, bottom: 450 };
    expect(toastBottom({ viewport, right: 20, width: 320, dock })).toBe(TOAST_BOTTOM);
  });
});
