import { expect, test } from "bun:test";
import { createTurnTouchGate } from "../client/utils/turn-touch-gate";

test("a touch that begins mid-turn is dropped, all of it", () => {
  let turning = true;
  const admit = createTurnTouchGate(() => turning);
  expect(admit("begin")).toBe(false);
  turning = false;
  // The turn landing doesn't let the rest of that touch through.
  expect(admit("move")).toBe(false);
  expect(admit("end")).toBe(false);
  // The next touch is the user's again.
  expect(admit("begin")).toBe(true);
  expect(admit("end")).toBe(true);
});

test("a touch already down when a turn starts carries on", () => {
  let turning = false;
  const admit = createTurnTouchGate(() => turning);
  expect(admit("begin")).toBe(true);
  turning = true;
  expect(admit("move")).toBe(true);
  expect(admit("end")).toBe(true);
});
