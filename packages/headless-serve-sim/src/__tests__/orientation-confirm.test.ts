import { expect, test } from "bun:test";
import { confirmsOrientation } from "../client/utils/orientation-confirm";

test("an app turning right after our own turn is not read back", () => {
  // The read spawns devicectl, which stalls frames while iOS is still turning.
  expect(confirmsOrientation(10_400, 10_000)).toBe(false);
  expect(confirmsOrientation(11_400, 10_000)).toBe(false);
});

test("an app turning on its own, or long after our turn, is read back", () => {
  expect(confirmsOrientation(12_000, 10_000)).toBe(true);
  expect(confirmsOrientation(10_000, 0)).toBe(true);
});
