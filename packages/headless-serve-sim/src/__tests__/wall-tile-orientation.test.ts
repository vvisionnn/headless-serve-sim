import { expect, test } from "bun:test";
import { unturnedScreenBox } from "../client/utils/wall-tile-orientation";

// The stream is the glass's own (portrait) picture; a tile turned with the
// device lays it in a box of the glass's shape, turned into the screen.
test("an upright tile draws the picture straight into its screen", () => {
  expect(unturnedScreenBox({ width: 100, height: 200 }, 0)).toEqual({
    left: 0,
    top: 0,
    width: 100,
    height: 200,
    transform: undefined,
  });
});

test("a sideways tile turns the glass's picture into its landscape screen", () => {
  expect(unturnedScreenBox({ width: 200, height: 100 }, 90)).toEqual({
    left: 50,
    top: -50,
    width: 100,
    height: 200,
    transform: "rotate(90deg)",
  });
  expect(unturnedScreenBox({ width: 200, height: 100 }, -90).transform).toBe("rotate(-90deg)");
});

test("an upside-down tile keeps the box and turns the picture over", () => {
  expect(unturnedScreenBox({ width: 100, height: 200 }, 180)).toEqual({
    left: 0,
    top: 0,
    width: 100,
    height: 200,
    transform: "rotate(180deg)",
  });
});
