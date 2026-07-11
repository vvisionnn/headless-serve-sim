import { describe, expect, test } from "bun:test";
import { currentAppForDevice } from "../client/utils/current-app";

describe("currentAppForDevice", () => {
  test("never reuses a foreground PID after switching simulators", () => {
    const app = {
      device: "DEVICE-A",
      bundleId: "com.example.app",
      isReactNative: false,
      pid: 4242,
    };

    expect(currentAppForDevice(app, "DEVICE-A")).toBe(app);
    expect(currentAppForDevice(app, "DEVICE-B")).toBeNull();
  });
});
