import { expect, test } from "bun:test";
import { createSettleWatch } from "../client/utils/turn-settle";

const still = new Uint8ClampedArray([1, 2, 3, 4]);
const moved = new Uint8ClampedArray([9, 2, 3, 4]);

test("waits out the device turn even when the screen is still", () => {
  const settled = createSettleWatch({ minMs: 450, stillMs: 120, maxMs: 1500 });
  expect(settled(0, still)).toBe(false);
  expect(settled(300, still)).toBe(false);
  expect(settled(460, still)).toBe(true);
});

test("holds while iOS is still animating, then lets go once it stops", () => {
  const settled = createSettleWatch({ minMs: 450, stillMs: 120, maxMs: 1500 });
  settled(0, still);
  for (let t = 16; t <= 700; t += 16) expect(settled(t, t % 32 ? moved : still)).toBe(false);
  expect(settled(716, still)).toBe(false);
  expect(settled(800, still)).toBe(false);
  expect(settled(840, still)).toBe(true);
});

test("gives up after the cap", () => {
  const settled = createSettleWatch({ minMs: 450, stillMs: 120, maxMs: 1500 });
  settled(0, still);
  expect(settled(1490, moved)).toBe(false);
  expect(settled(1500, still)).toBe(true);
});

test("a missing sample counts as still", () => {
  const settled = createSettleWatch({ minMs: 450, stillMs: 120, maxMs: 1500 });
  settled(0, null);
  expect(settled(460, null)).toBe(true);
});
