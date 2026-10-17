import { expect, test } from "bun:test";
import { sameDuoBounds } from "../client/utils/duo-bounds";

const base = {
  x: 10,
  y: 20,
  width: 300,
  height: 400,
  fittedWidth: 300,
  fittedHeight: 400,
};

test("a resize that keeps the fitted size still counts as a change", () => {
  // Scaling the Duo grows the visible device while the fitted size stays put;
  // the dock under it must follow.
  expect(sameDuoBounds(base, { ...base, y: 0, width: 360, height: 480 })).toBe(false);
});

test("sub-pixel paint jitter is ignored", () => {
  expect(sameDuoBounds(base, { ...base, x: 10.3, height: 400.4 })).toBe(true);
});
