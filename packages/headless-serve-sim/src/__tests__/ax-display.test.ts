import { expect, test } from "bun:test";
import { axSnapshotForDisplay } from "../client/utils/ax-display";
import type { AxSnapshot } from "../ax-shared";

const element = (frame: { x: number; y: number; width: number; height: number }) => ({
  id: "e",
  path: "0.0",
  label: "Settings",
  value: "",
  role: "",
  type: "Heading",
  enabled: true,
  frame,
});

const portraitSettings: AxSnapshot = {
  screen: { width: 420, height: 912 },
  elements: [element({ x: 20, y: 126, width: 133, height: 41 })],
};

test("an interface that turned with the device is drawn as is", () => {
  expect(axSnapshotForDisplay(portraitSettings, "portrait", "portrait")).toBe(portraitSettings);
  expect(axSnapshotForDisplay(portraitSettings, "landscape_left", "landscape_left")).toBe(
    portraitSettings,
  );
});

test("a portrait-only app on a sideways phone is drawn turned with the glass", () => {
  // The title of portrait Settings, the phone turned to landscape_right: it
  // reads bottom-to-top along the left of the landscape screen.
  const shown = axSnapshotForDisplay(portraitSettings, "portrait", "landscape_right");
  expect(shown.screen).toEqual({ width: 912, height: 420 });
  expect(shown.elements[0]!.frame).toEqual({ x: 126, y: 267, width: 41, height: 133 });
  const other = axSnapshotForDisplay(portraitSettings, "portrait", "landscape_left");
  expect(other.elements[0]!.frame).toEqual({ x: 745, y: 20, width: 41, height: 133 });
  const upsideDown = axSnapshotForDisplay(portraitSettings, "portrait", "portrait_upside_down");
  expect(upsideDown.screen).toEqual({ width: 420, height: 912 });
  expect(upsideDown.elements[0]!.frame).toEqual({ x: 267, y: 745, width: 133, height: 41 });
});

test("a landscape interface on an upright device turns back", () => {
  const landscape: AxSnapshot = {
    screen: { width: 912, height: 420 },
    elements: [element({ x: 126, y: 267, width: 41, height: 133 })],
  };
  const shown = axSnapshotForDisplay(landscape, "landscape_right", "portrait");
  expect(shown.screen).toEqual({ width: 420, height: 912 });
  expect(shown.elements[0]!.frame).toEqual({ x: 20, y: 126, width: 133, height: 41 });
});

test("without both orientations the snapshot is drawn as is", () => {
  expect(axSnapshotForDisplay(portraitSettings, undefined, "landscape_left")).toBe(
    portraitSettings,
  );
});
