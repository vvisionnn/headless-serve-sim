import { expect, test } from "bun:test";
import { framesDiffer } from "../client/utils/stream-motion";

const frame = (fill: (i: number) => number) =>
  Uint8ClampedArray.from({ length: 16 * 16 * 4 }, (_, i) => (i % 4 === 3 ? 255 : fill(i)));

test("encoder noise is not motion", () => {
  const a = frame(() => 120);
  const b = frame((i) => 120 + (i % 7 === 0 ? 3 : 0));
  expect(framesDiffer(a, b)).toBe(false);
});

test("a rotating screen is motion", () => {
  const a = frame(() => 230);
  const b = frame((i) => (i < 16 * 4 * 3 ? 0 : 230)); // a black corner creeps in
  expect(framesDiffer(a, b)).toBe(true);
});

test("a missing frame is not motion", () => {
  expect(
    framesDiffer(
      null,
      frame(() => 0),
    ),
  ).toBe(false);
});
