import { describe, expect, test } from "bun:test";
import { selectedSimulatorTarget } from "../client/utils/selected-simulator-connection";

describe("selected simulator connection", () => {
  test("keeps an explicit URL simulator as the reconnect target without a live config", () => {
    expect(
      selectedSimulatorTarget({
        urlDevice: "SELECTED-DEVICE",
        liveDevice: null,
        liveDeviceName: null,
      }),
    ).toEqual({ udid: "SELECTED-DEVICE", name: null });
  });

  test("never replaces an explicit URL simulator with a different live simulator", () => {
    expect(
      selectedSimulatorTarget({
        urlDevice: "SELECTED-DEVICE",
        liveDevice: "OTHER-BOOTED-DEVICE",
        liveDeviceName: "Other iPhone",
      }),
    ).toEqual({ udid: "SELECTED-DEVICE", name: null });
  });

  test("does not infer a reconnect target without a user selection", () => {
    expect(
      selectedSimulatorTarget({
        urlDevice: null,
        liveDevice: null,
        liveDeviceName: null,
      }),
    ).toBeNull();
  });
});
