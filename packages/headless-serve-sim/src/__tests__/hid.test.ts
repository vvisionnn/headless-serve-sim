import { describe, expect, test } from "bun:test";
import {
  HID_USAGE_BY_CODE,
  hidUsageForCode,
  reactNativeReloadKeys,
  releasePressedKeys,
  syncKeyboardModifiers,
} from "../client/utils/hid";

describe("hidUsageForCode", () => {
  test("maps known codes to USB HID keyboard usages", () => {
    expect(hidUsageForCode("KeyA")).toBe(0x04);
    expect(hidUsageForCode("Enter")).toBe(0x28);
  });

  test("returns null for an unmapped code", () => {
    expect(hidUsageForCode("Nonsense")).toBeNull();
  });
});

test("losing browser focus releases held modifiers and keys once", () => {
  const pressed = new Set([HID_USAGE_BY_CODE.MetaLeft!, HID_USAGE_BY_CODE.KeyX!]);
  const released: number[] = [];
  releasePressedKeys(pressed, (usage) => released.push(usage));
  expect(released).toEqual([0xe3, 0x1b]);
  expect(pressed.size).toBe(0);
  releasePressedKeys(pressed, (usage) => released.push(usage));
  expect(released).toEqual([0xe3, 0x1b]);
});

test("shortcut modifier flags restore a Command keydown missed before preview focus", () => {
  const pressed = new Set<number>();
  const events: Array<[string, number]> = [];
  const send = (type: "down" | "up", usage: number) => events.push([type, usage]);
  syncKeyboardModifiers(
    { code: "KeyA", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false },
    pressed,
    send,
  );
  expect(events).toEqual([["down", 0xe3]]);
  expect(pressed.has(0xe3)).toBe(true);
  syncKeyboardModifiers(
    { code: "KeyA", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false },
    pressed,
    send,
  );
  expect(events).toHaveLength(1);
  syncKeyboardModifiers(
    { code: "KeyX", metaKey: false, shiftKey: false, altKey: false, ctrlKey: false },
    pressed,
    send,
  );
  expect(events).toEqual([
    ["down", 0xe3],
    ["up", 0xe3],
  ]);
  expect(pressed.size).toBe(0);
});

test("releasing Command also releases shortcut keys whose keyup was omitted", () => {
  const pressed = new Set([0xe3, 0x04, 0x06, 0xe1]);
  const events: Array<[string, number]> = [];
  syncKeyboardModifiers(
    { code: "MetaLeft", metaKey: false, shiftKey: true, altKey: false, ctrlKey: false },
    pressed,
    (type, usage) => events.push([type, usage]),
  );
  expect(events).toEqual([
    ["up", 0x04],
    ["up", 0x06],
  ]);
  expect([...pressed]).toEqual([0xe3, 0xe1]);
});

test("successive shortcuts release omitted keyups while Command stays held", () => {
  const pressed = new Set([0xe3, 0x04]);
  const events: Array<[string, number]> = [];
  const send = (type: "down" | "up", usage: number) => events.push([type, usage]);
  syncKeyboardModifiers(
    {
      type: "keydown",
      repeat: false,
      code: "ArrowRight",
      metaKey: true,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    },
    pressed,
    send,
  );
  expect(events).toEqual([["up", 0x04]]);
  pressed.add(0x4f);
  syncKeyboardModifiers(
    {
      type: "keydown",
      repeat: false,
      code: "KeyA",
      metaKey: true,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    },
    pressed,
    send,
  );
  expect(events).toEqual([
    ["up", 0x04],
    ["up", 0x4f],
  ]);
  expect([...pressed]).toEqual([0xe3]);
});

test("Command key repeats do not release the repeated key", () => {
  const pressed = new Set([0xe3, 0x4f]);
  const events: Array<[string, number]> = [];
  for (const type of ["keydown", "keyup"]) {
    syncKeyboardModifiers(
      {
        type,
        repeat: true,
        code: "ArrowRight",
        metaKey: true,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      },
      pressed,
      (phase, usage) => events.push([phase, usage]),
    );
  }
  expect(events).toEqual([]);
  expect([...pressed]).toEqual([0xe3, 0x4f]);
});

test("modifier synchronization preserves right-hand modifiers and physical transitions", () => {
  const pressed = new Set([0xe7]);
  const events: Array<[string, number]> = [];
  const send = (type: "down" | "up", usage: number) => events.push([type, usage]);
  syncKeyboardModifiers(
    { code: "ArrowLeft", metaKey: true, shiftKey: true, altKey: true, ctrlKey: true },
    pressed,
    send,
  );
  expect(events).toEqual([
    ["down", 0xe0],
    ["down", 0xe1],
    ["down", 0xe2],
  ]);
  expect(pressed.has(0xe3)).toBe(false);
  syncKeyboardModifiers(
    { code: "MetaRight", metaKey: false, shiftKey: true, altKey: true, ctrlKey: true },
    pressed,
    send,
  );
  expect(pressed.has(0xe7)).toBe(true);
  expect(events).toHaveLength(3);
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
