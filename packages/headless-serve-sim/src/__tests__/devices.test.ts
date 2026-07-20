import { describe, expect, test } from "bun:test";
import { parseSimctlList } from "../client/utils/devices";

describe("parseSimctlList", () => {
  test("preserves the immutable device type identifier for renamed simulators", () => {
    expect(
      parseSimctlList(
        JSON.stringify({
          devices: {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
              {
                udid: "DEVICE-1",
                name: "My isolated simulator",
                state: "Booted",
                isAvailable: true,
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        udid: "DEVICE-1",
        name: "My isolated simulator",
        state: "Booted",
        runtime: "iOS.26.2",
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      },
    ]);
  });
});
