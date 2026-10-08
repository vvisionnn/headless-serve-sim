// Browser KeyboardEvent.code → USB HID Usage Page 0x07 keyboard usage code.
// See https://usb.org/sites/default/files/hut1_5.pdf §10 (Keyboard/Keypad Page).
export const HID_USAGE_BY_CODE: Record<string, number> = {
  KeyA: 0x04,
  KeyB: 0x05,
  KeyC: 0x06,
  KeyD: 0x07,
  KeyE: 0x08,
  KeyF: 0x09,
  KeyG: 0x0a,
  KeyH: 0x0b,
  KeyI: 0x0c,
  KeyJ: 0x0d,
  KeyK: 0x0e,
  KeyL: 0x0f,
  KeyM: 0x10,
  KeyN: 0x11,
  KeyO: 0x12,
  KeyP: 0x13,
  KeyQ: 0x14,
  KeyR: 0x15,
  KeyS: 0x16,
  KeyT: 0x17,
  KeyU: 0x18,
  KeyV: 0x19,
  KeyW: 0x1a,
  KeyX: 0x1b,
  KeyY: 0x1c,
  KeyZ: 0x1d,
  Digit1: 0x1e,
  Digit2: 0x1f,
  Digit3: 0x20,
  Digit4: 0x21,
  Digit5: 0x22,
  Digit6: 0x23,
  Digit7: 0x24,
  Digit8: 0x25,
  Digit9: 0x26,
  Digit0: 0x27,
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  CapsLock: 0x39,
  F1: 0x3a,
  F2: 0x3b,
  F3: 0x3c,
  F4: 0x3d,
  F5: 0x3e,
  F6: 0x3f,
  F7: 0x40,
  F8: 0x41,
  F9: 0x42,
  F10: 0x43,
  F11: 0x44,
  F12: 0x45,
  PrintScreen: 0x46,
  ScrollLock: 0x47,
  Pause: 0x48,
  Insert: 0x49,
  Home: 0x4a,
  PageUp: 0x4b,
  Delete: 0x4c,
  End: 0x4d,
  PageDown: 0x4e,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
  NumLock: 0x53,
  NumpadDivide: 0x54,
  NumpadMultiply: 0x55,
  NumpadSubtract: 0x56,
  NumpadAdd: 0x57,
  NumpadEnter: 0x58,
  Numpad1: 0x59,
  Numpad2: 0x5a,
  Numpad3: 0x5b,
  Numpad4: 0x5c,
  Numpad5: 0x5d,
  Numpad6: 0x5e,
  Numpad7: 0x5f,
  Numpad8: 0x60,
  Numpad9: 0x61,
  Numpad0: 0x62,
  NumpadDecimal: 0x63,
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7,
};

export function hidUsageForCode(code: string): number | null {
  return HID_USAGE_BY_CODE[code] ?? null;
}

export function syncKeyboardModifiers(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "type" | "repeat">>,
  pressed: Set<number>,
  send: (type: "down" | "up", usage: number) => void,
): void {
  // macOS can omit letter keyups while Command is held, including between shortcuts.
  const nextShortcut =
    event.metaKey &&
    event.type === "keydown" &&
    !event.repeat &&
    !["Control", "Shift", "Alt", "Meta"].some((modifier) => event.code.startsWith(modifier));
  if (nextShortcut || (!event.metaKey && (pressed.has(0xe3) || pressed.has(0xe7)))) {
    for (const usage of pressed) {
      if (usage < 0xe0 || usage > 0xe7) {
        pressed.delete(usage);
        send("up", usage);
      }
    }
  }
  for (const [code, left, right, active] of [
    ["Control", 0xe0, 0xe4, event.ctrlKey],
    ["Shift", 0xe1, 0xe5, event.shiftKey],
    ["Alt", 0xe2, 0xe6, event.altKey],
    ["Meta", 0xe3, 0xe7, event.metaKey],
  ] as const) {
    // Physical modifier events are forwarded normally; reconcile only other keys.
    if (event.code === `${code}Left` || event.code === `${code}Right`) continue;
    if (active) {
      if (!pressed.has(left) && !pressed.has(right)) {
        pressed.add(left);
        send("down", left);
      }
    } else {
      for (const usage of [left, right]) {
        if (pressed.delete(usage)) send("up", usage);
      }
    }
  }
}

export function releasePressedKeys(pressed: Set<number>, release: (usage: number) => void): void {
  const held = [...pressed];
  pressed.clear();
  for (const usage of held) release(usage);
}

/**
 * Key events that reload a React Native / Expo bundle.
 *
 * RN registers reload *with* the Command modifier (RCTReloadCommand.m), but
 * RCTKeyCommands matches on `_flags == flags || flags == 0` — an incoming
 * event carrying no modifiers matches a command registered under any modifier.
 * So a bare R fires reload regardless of how the app registered it, whereas
 * Cmd+R only fires if our injected modifier state is reported back as exactly
 * UIKeyModifierCommand. Send the plain key: it's the wildcard.
 */
export function reactNativeReloadKeys(): Array<{ type: "down" | "up"; usage: number }> {
  const R = HID_USAGE_BY_CODE.KeyR!;
  return [
    { type: "down", usage: R },
    { type: "up", usage: R },
  ];
}
