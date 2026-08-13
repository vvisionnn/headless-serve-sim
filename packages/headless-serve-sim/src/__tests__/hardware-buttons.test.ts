import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { hardwareButtonAction, isPressableControl } from "../client/utils/hardware-buttons";
import { HIDUsage } from "../client/utils/hid-usage";

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

  // The Action button has no consumer usage of its own; the only one it could
  // ride (menu) is Home, so mapping it would background the app under test.
  test("does not map the Action button", () => {
    expect(hardwareButtonAction("action")).toBeNull();
    expect(isPressableControl("action")).toBe(false);
  });

  test("returns null for an unknown control", () => {
    expect(hardwareButtonAction("nonsense")).toBeNull();
  });

  test("every action carries either a named button or a HID usage", () => {
    for (const name of ["home", "power", "mute", "volume-up"]) {
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
