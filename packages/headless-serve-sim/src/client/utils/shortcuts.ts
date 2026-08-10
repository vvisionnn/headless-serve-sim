/**
 * Global keyboard shortcuts handled by the preview chrome rather than being
 * forwarded to the guest.
 *
 * The predicates are pure so the modifier combinations are testable — the
 * distinction that matters is exclusivity. `e.metaKey` alone is true for ⇧⌘K
 * and ⌥⌘K too, so a shortcut that only checks it swallows neighbouring
 * combinations the guest (or the browser) should have received.
 */

/** Element types where a keystroke belongs to the user's text entry, not us. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" || element.tagName === "TEXTAREA" || !!element.isContentEditable
  );
}

export interface ShortcutModifiers {
  code: string;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

/**
 * ⌘K — toggle the on-screen software keyboard, matching Simulator.app's
 * I/O → Keyboard → Toggle Software Keyboard. Exactly Command, so ⇧⌘K and ⌥⌘K
 * still reach whatever else wants them.
 */
export function isSoftwareKeyboardShortcut(event: ShortcutModifiers): boolean {
  return (
    event.code === "KeyK" && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey
  );
}
