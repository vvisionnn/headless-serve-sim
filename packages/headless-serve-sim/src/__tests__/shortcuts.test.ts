import { describe, expect, test } from "bun:test";
import {
  isSoftwareKeyboardShortcut,
  isTextEntryTarget,
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
  test("matches a bare Cmd+K", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent())).toBe(true);
  });

  test("ignores K without Command", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ metaKey: false }))).toBe(false);
  });

  test("ignores another key with Command", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ code: "KeyJ" }))).toBe(false);
  });

  // Checking metaKey alone would swallow every neighbouring combination, so
  // the guest and the browser would silently stop receiving them.
  test("ignores Cmd+K with an extra modifier", () => {
    expect(isSoftwareKeyboardShortcut(keyEvent({ shiftKey: true }))).toBe(false);
    expect(isSoftwareKeyboardShortcut(keyEvent({ altKey: true }))).toBe(false);
    expect(isSoftwareKeyboardShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
  });
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
