import { describe, expect, test } from "bun:test";
import { selectedSimulatorReattachRequest } from "../client/utils/selected-simulator-reattach";

describe("selected simulator reattach", () => {
  test("requests only the selected simulator while its helper is unavailable", () => {
    expect(selectedSimulatorReattachRequest(false, "SELECTED-DEVICE")).toEqual({
      udid: "SELECTED-DEVICE",
    });
    expect(selectedSimulatorReattachRequest(true, "SELECTED-DEVICE")).toBeNull();
    expect(selectedSimulatorReattachRequest(false, null)).toBeNull();
  });
});
