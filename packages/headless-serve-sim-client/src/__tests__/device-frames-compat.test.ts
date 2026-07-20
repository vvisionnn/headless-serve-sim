import { expect, test } from "bun:test";
import {
  DEVICE_BEZEL_X,
  DEVICE_BEZEL_Y,
  DEVICE_FRAMES,
  DEVICE_HEIGHT,
  DEVICE_INNER_RADIUS,
  DEVICE_WIDTH,
} from "../simulator/deviceFrames";

test("legacy iPhone frame exports stay aligned with DEVICE_FRAMES", () => {
  expect({
    width: DEVICE_WIDTH,
    height: DEVICE_HEIGHT,
    bezelX: DEVICE_BEZEL_X,
    bezelY: DEVICE_BEZEL_Y,
    innerRadius: DEVICE_INNER_RADIUS,
  }).toEqual(DEVICE_FRAMES.iphone);
});
