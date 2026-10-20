import { expect, test } from "bun:test";
import { cliTouchPayload } from "../cli-touch";

test("CLI coordinates are the screen as it looks, so the helper maps them for rotation", () => {
  expect(cliTouchPayload({ type: "begin", x: 0.9, y: 0.1 })).toEqual({
    type: "begin",
    x: 0.9,
    y: 0.1,
    space: "interface",
  });
});

test("a gesture that names its own space keeps it", () => {
  expect(cliTouchPayload({ type: "end", x: 0.2, y: 0.3, space: "panel" })).toEqual({
    type: "end",
    x: 0.2,
    y: 0.3,
    space: "panel",
  });
});
