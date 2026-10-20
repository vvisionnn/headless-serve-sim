import { expect, test } from "bun:test";
import { containedStreamBox } from "../simulator/stream-box";

test("the stream box fits its aspect in CSS, with no measured size to lag a resize", () => {
  // Resolved against the viewport, a size container, on the frame it changes.
  expect(containedStreamBox({ width: 1032, height: 1376 })).toEqual({
    width: "min(100cqw, calc(100cqh * 1032 / 1376))",
    height: "min(100cqh, calc(100cqw * 1376 / 1032))",
  });
});

test("before the stream's size is known the box fills the viewport", () => {
  expect(containedStreamBox(null)).toEqual({ width: "100%", height: "100%" });
  expect(containedStreamBox({ width: 0, height: 0 })).toEqual({ width: "100%", height: "100%" });
});
