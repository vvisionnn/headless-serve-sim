import { describe, expect, test } from "bun:test";
import {
  currentAppForDevice,
  goHomeAndSelectSpringBoard,
  type DetectedAppState,
} from "../client/utils/current-app";

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

describe("goHomeAndSelectSpringBoard", () => {
  test("sends Home and replaces the edge-triggered foreground app state", () => {
    const calls: string[] = [];
    const selected: DetectedAppState[] = [];

    goHomeAndSelectSpringBoard(
      "DEVICE-A",
      () => calls.push("home"),
      (app) => {
        calls.push("select");
        selected.push(app);
      },
    );

    expect(calls).toEqual(["home", "select"]);
    expect(selected).toEqual([
      {
        device: "DEVICE-A",
        bundleId: "com.apple.springboard",
        isReactNative: false,
      },
    ]);
  });
});
