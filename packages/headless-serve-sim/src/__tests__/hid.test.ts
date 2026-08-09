import { describe, expect, test } from "bun:test";
import { HID_USAGE_BY_CODE, hidUsageForCode, reactNativeReloadKeys } from "../client/utils/hid";

describe("hidUsageForCode", () => {
  test("maps known codes to USB HID keyboard usages", () => {
    expect(hidUsageForCode("KeyA")).toBe(0x04);
    expect(hidUsageForCode("Enter")).toBe(0x28);
  });

  test("returns null for an unmapped code", () => {
    expect(hidUsageForCode("Nonsense")).toBeNull();
  });
});

describe("reactNativeReloadKeys", () => {
  // RN registers reload with UIKeyModifierCommand, but RCTKeyCommands matches
  // on `_flags == flags || flags == 0`, so an event with NO modifiers matches a
  // command registered under any modifier. Sending Cmd means relying on our
  // injected modifier state being reported back as exactly UIKeyModifierCommand;
  // sending bare R takes the wildcard branch and always fires.
  test("sends a bare R with no modifier keys", () => {
    const keys = reactNativeReloadKeys();
    const R = HID_USAGE_BY_CODE.KeyR!;
    expect(keys).toEqual([
      { type: "down", usage: R },
      { type: "up", usage: R },
    ]);
  });

  test("carries no modifier usage in the sequence", () => {
    const modifiers = new Set([
      HID_USAGE_BY_CODE.ControlLeft,
      HID_USAGE_BY_CODE.ShiftLeft,
      HID_USAGE_BY_CODE.AltLeft,
      HID_USAGE_BY_CODE.MetaLeft,
      HID_USAGE_BY_CODE.ControlRight,
      HID_USAGE_BY_CODE.ShiftRight,
      HID_USAGE_BY_CODE.AltRight,
      HID_USAGE_BY_CODE.MetaRight,
    ]);
    for (const key of reactNativeReloadKeys()) {
      expect(modifiers.has(key.usage)).toBe(false);
    }
  });

  test("presses and releases so no key is left held", () => {
    const keys = reactNativeReloadKeys();
    const held = new Set<number>();
    for (const key of keys) {
      if (key.type === "down") held.add(key.usage);
      else held.delete(key.usage);
    }
    expect(held.size).toBe(0);
  });
});
