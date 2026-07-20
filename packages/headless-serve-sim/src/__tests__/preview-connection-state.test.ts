import { describe, expect, test } from "bun:test";
import { updateSelectedPreviewConnection } from "../client/utils/preview-connection-state";

describe("selected preview connection state", () => {
  test("retains the device screen config while the selected helper is unavailable", () => {
    const config = { device: "SELECTED-DEVICE", streamUrl: "previous-stream" };

    expect(
      updateSelectedPreviewConnection({ config, helperAvailable: true }, null, "SELECTED-DEVICE"),
    ).toEqual({ config, helperAvailable: false });
  });

  test("never replaces the retained screen with another simulator", () => {
    const config = { device: "SELECTED-DEVICE", streamUrl: "previous-stream" };

    expect(
      updateSelectedPreviewConnection(
        { config, helperAvailable: false },
        { device: "OTHER-BOOTED-DEVICE", streamUrl: "other-stream" },
        "SELECTED-DEVICE",
      ),
    ).toEqual({ config, helperAvailable: false });
  });

  test("removes the cover only when the selected simulator returns", () => {
    const previous = { device: "SELECTED-DEVICE", streamUrl: "previous-stream" };
    const reconnected = { device: "SELECTED-DEVICE", streamUrl: "new-stream" };

    expect(
      updateSelectedPreviewConnection(
        { config: previous, helperAvailable: false },
        reconnected,
        "SELECTED-DEVICE",
      ),
    ).toEqual({ config: reconnected, helperAvailable: true });
  });
});
