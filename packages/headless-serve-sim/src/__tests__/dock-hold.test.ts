import { expect, test } from "bun:test";
import { DOCK_HOLD_MS, dockHoldLeft } from "../client/utils/dock-hold";

test("the dock stays put for as long as the pointer is over it", () => {
  expect(dockHoldLeft(true, 0, 10_000)).toBe(Infinity);
});

test("a press holds the dock a beat after it, for a touch with no hover", () => {
  expect(dockHoldLeft(false, 1000, 1000)).toBe(DOCK_HOLD_MS);
  expect(dockHoldLeft(false, 1000, 1000 + DOCK_HOLD_MS / 2)).toBe(DOCK_HOLD_MS / 2);
  expect(dockHoldLeft(false, 1000, 1000 + DOCK_HOLD_MS)).toBe(0);
  expect(dockHoldLeft(false, 1000, 5000)).toBe(0);
});

test("never pressed and not hovered, the dock is free to follow the device", () => {
  expect(dockHoldLeft(false, 0, Date.now())).toBe(0);
});
