import { describe, expect, test } from "bun:test";
import {
  isCommandPaletteShortcut,
  isSoftwareKeyboardShortcut,
  clipboardShortcut,
  isTextEntryTarget,
  isPreviewControlTarget,
  type ShortcutModifiers,
} from "../client/utils/shortcuts";

function keyEvent(overrides: Partial<ShortcutModifiers> = {}): ShortcutModifiers {
  return {
    code: "KeyK",
    metaKey: true,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

describe("isSoftwareKeyboardShortcut", () => {
  test("matches Option+Cmd+K", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ altKey: true }))).toBe(true);
  });

  test("leaves bare Cmd+K to the command palette", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent())).toBe(false);
  });

  test("ignores K without Command", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ altKey: true, metaKey: false }))).toBe(false);
  });

  test("ignores another key with Option+Command", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ altKey: true, code: "KeyJ" }))).toBe(false);
  });

  // Checking metaKey alone would swallow every neighbouring combination, so
  // the guest and the browser would silently stop receiving them.
  test("ignores Option+Cmd+K with an extra modifier", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ altKey: true, shiftKey: true }))).toBe(false);
    expect(isSoftwareKeyboardShortcut(keyEvent({ altKey: true, ctrlKey: true }))).toBe(false);
  });
});

describe("isCommandPaletteShortcut", () => {
  test("matches Cmd+K and Ctrl+K", () => {
    expect(isCommandPaletteShortcut(keyEvent())).toBe(true);
    expect(isCommandPaletteShortcut(keyEvent({ metaKey: false, ctrlKey: true }))).toBe(true);
  });

  test("ignores K alone, other keys and extra modifiers", () => {
    expect(isCommandPaletteShortcut(keyEvent({ metaKey: false }))).toBe(false);
    expect(isCommandPaletteShortcut(keyEvent({ code: "KeyJ" }))).toBe(false);
    expect(isCommandPaletteShortcut(keyEvent({ altKey: true }))).toBe(false);
    expect(isCommandPaletteShortcut(keyEvent({ shiftKey: true }))).toBe(false);
  });
});

test("recognizes only exact native clipboard editing shortcuts", () => {
  for (const [code, action] of [
    ["KeyC", "copy"],
    ["KeyX", "cut"],
    ["KeyV", "paste"],
  ] as const) {
    expect(clipboardShortcut(keyEvent({ code }))).toBe(action);
    expect(clipboardShortcut(keyEvent({ code, metaKey: false }))).toBeNull();
    expect(clipboardShortcut(keyEvent({ code, shiftKey: true }))).toBeNull();
    expect(clipboardShortcut(keyEvent({ code, altKey: true }))).toBeNull();
    expect(clipboardShortcut(keyEvent({ code, ctrlKey: true }))).toBeNull();
  }
  expect(clipboardShortcut(keyEvent({ code: "KeyA" }))).toBeNull();
});

test("keyboard capture leaves native preview controls operable", () => {
  for (const tagName of ["BUTTON", "SELECT", "SUMMARY", "A"]) {
    expect(isPreviewControlTarget({ tagName } as unknown as EventTarget)).toBe(true);
  }
  expect(isPreviewControlTarget({ tagName: "CANVAS" } as unknown as EventTarget)).toBe(false);
});

describe("isTextEntryTarget", () => {
  test("treats inputs and textareas as text entry", () => {
    expect(isTextEntryTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
  });

  test("treats contenteditable as text entry", () => {
    expect(
      isTextEntryTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
  });

  test("does not claim ordinary elements", () => {
    expect(
      isTextEntryTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget),
    ).toBe(false);
    expect(isTextEntryTarget({ tagName: "CANVAS" } as unknown as EventTarget)).toBe(false);
  });

  test("handles a null target", () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
