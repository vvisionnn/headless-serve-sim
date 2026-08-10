import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { hardwareButtonEntries } from "../client/components/device-hardware-buttons";
import { hardwareButtonAction, isPressableControl } from "../client/utils/hardware-buttons";
import { HIDUsage } from "../client/utils/hid-usage";

function asset(width: number, height: number) {
  return { pngDataUrl: "data:image/png;base64,", width, height };
}

/** Frame with a chrome opening at (100,100) sized 400×800. */
function frameWith(
  controls: Array<{
    name: string;
    anchor: "left" | "right" | "top" | "bottom";
    width: number;
    height: number;
    offset: { x: number; y: number };
  }>,
): DeviceFrameSpec {
  return {
    deviceTypeIdentifier: "test",
    modelName: "Test",
    family: "iphone",
    nativeScreen: { width: 400, height: 800 },
    insetsPx: { top: 0, right: 0, bottom: 0, left: 0 },
    screenRadiiPx: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    outerRadiiPx: { x: 0, y: 0 },
    cutout: "none",
    chromeIdentifier: "test",
    artwork: {
      width: 600,
      height: 1000,
      chromeRectPx: { x: 100, y: 100, width: 400, height: 800 },
      slices: {
        topLeft: asset(1, 1),
        top: asset(1, 1),
        topRight: asset(1, 1),
        right: asset(1, 1),
        bottomRight: asset(1, 1),
        bottom: asset(1, 1),
        bottomLeft: asset(1, 1),
        left: asset(1, 1),
      },
      controls: controls.map((c) => ({
        name: c.name,
        image: asset(c.width, c.height),
        onTop: false,
        anchor: c.anchor,
        align: "leading" as const,
        normalOffsetPx: c.offset,
        rolloverOffsetPx: c.offset,
      })),
    },
  } as DeviceFrameSpec;
}

describe("hardwareButtonAction", () => {
  // These names come from chrome.json's `inputs` across the installed
  // DeviceKit chromes. Any of them appearing without a mapping renders a
  // control that looks pressable and does nothing.
  test("maps every pressable DeviceKit control name", () => {
    for (const name of [
      "home",
      "power",
      "side-button",
      "left-side-button",
      "mute",
      "volume-up",
      "volume-down",
      "action",
    ]) {
      expect(hardwareButtonAction(name)).not.toBeNull();
    }
  });

  test("is case-insensitive", () => {
    expect(hardwareButtonAction("Volume-Up")).toEqual(hardwareButtonAction("volume-up"));
  });

  // The crown rotates rather than presses, and the wheel handler already
  // drives it; a tab for it would be dead UI.
  test("does not treat the digital crown as a button", () => {
    expect(hardwareButtonAction("digital-crown")).toBeNull();
    expect(isPressableControl("digital-crown")).toBe(false);
  });

  test("returns null for an unknown control", () => {
    expect(hardwareButtonAction("nonsense")).toBeNull();
  });

  test("every action carries either a named button or a HID usage", () => {
    for (const name of ["home", "power", "mute", "action", "volume-up"]) {
      const action = hardwareButtonAction(name)!;
      const hasUsage = action.usagePage !== undefined && action.usage !== undefined;
      expect(!!action.button || hasUsage).toBe(true);
      expect(action.label.length).toBeGreaterThan(0);
    }
  });

  test("raw usages ride the consumer page", () => {
    const action = hardwareButtonAction("mute")!;
    expect(action.usagePage).toBe(HIDUsage.consumerPage);
  });
});

describe("hardwareButtonEntries", () => {
  test("no frame or no artwork yields nothing", () => {
    expect(hardwareButtonEntries(null)).toEqual([]);
    expect(hardwareButtonEntries({ artwork: undefined } as DeviceFrameSpec)).toEqual([]);
  });

  test("reports the edge a control sits on", () => {
    const frame = frameWith([
      { name: "volume-up", anchor: "left", width: 10, height: 80, offset: { x: 0, y: 200 } },
    ]);
    const [entry] = hardwareButtonEntries(frame);
    expect(entry?.edge).toBe("left");
    // y offset 200 of an 800-tall opening — used only to order the row.
    expect(entry?.position).toBeCloseTo(0.25);
  });

  test("orders left-edge controls before right-edge ones, each top to bottom", () => {
    // The row should read like the hardware does, not like plist order.
    const frame = frameWith([
      { name: "power", anchor: "right", width: 10, height: 40, offset: { x: 0, y: 300 } },
      { name: "volume-down", anchor: "left", width: 10, height: 40, offset: { x: 0, y: 400 } },
      { name: "volume-up", anchor: "left", width: 10, height: 40, offset: { x: 0, y: 200 } },
    ]);
    expect(hardwareButtonEntries(frame).map((e) => e.name)).toEqual([
      "volume-up",
      "volume-down",
      "power",
    ]);
  });

  test("skips controls with no button mapping", () => {
    const frame = frameWith([
      { name: "digital-crown", anchor: "right", width: 10, height: 40, offset: { x: 0, y: 100 } },
      { name: "power", anchor: "right", width: 10, height: 40, offset: { x: 0, y: 300 } },
    ]);
    expect(hardwareButtonEntries(frame).map((e) => e.name)).toEqual(["power"]);
  });

  // A control whose artwork starts above the screen opening gives a negative
  // offset; unclamped it would sort ahead of everything for no real reason.
  test("clamps the ordering position into range", () => {
    const frame = frameWith([
      { name: "mute", anchor: "left", width: 10, height: 40, offset: { x: 0, y: -500 } },
    ]);
    const [entry] = hardwareButtonEntries(frame);
    expect(entry!.position).toBeGreaterThanOrEqual(0);
    expect(entry!.position).toBeLessThanOrEqual(1);
  });

  test("a degenerate chrome rect yields nothing rather than dividing by zero", () => {
    const frame = frameWith([
      { name: "power", anchor: "left", width: 10, height: 40, offset: { x: 0, y: 10 } },
    ]);
    frame.artwork!.chromeRectPx = { x: 0, y: 0, width: 0, height: 0 };
    expect(hardwareButtonEntries(frame)).toEqual([]);
  });
});

describe("HID usage tables stay in sync with the helper", () => {
  // The bezel buttons send raw page+usage, so the TS table and the Swift one
  // must agree or a press reaches the wrong control. Read the Swift source
  // rather than trusting a comment.
  const swift = readFileSync(
    resolve(__dirname, "../../../headless-serve-sim-binary/Sources/SimStreamHelper/HIDUsage.swift"),
    "utf8",
  );

  function swiftUsage(name: string): number | null {
    const match = new RegExp(`static let ${name}: UInt32 = (0x[0-9A-Fa-f]+)`).exec(swift);
    return match ? Number(match[1]) : null;
  }

  test.each([
    ["consumerPage", HIDUsage.consumerPage],
    ["keyboardPage", HIDUsage.keyboardPage],
    ["menu", HIDUsage.menu],
    ["power", HIDUsage.power],
    ["volumeUp", HIDUsage.volumeUp],
    ["volumeDown", HIDUsage.volumeDown],
    ["mute", HIDUsage.mute],
  ])("%s matches the Swift value", (name, value) => {
    expect(swiftUsage(name)).toBe(value);
  });
});
