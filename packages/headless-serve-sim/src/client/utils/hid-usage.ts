/**
 * USB HID usages shared by the client and mirrored in the Swift helper's
 * HIDUsage.swift. Kept in one place so a value can't drift between the two.
 *
 * See the USB HID Usage Tables, Consumer Page (0x0C).
 */
export const HIDUsage = {
  consumerPage: 0x0c,
  keyboardPage: 0x07,
  /** Menu — what the simulator accepts as Home. */
  menu: 0x40,
  /** Power — lock / wake. */
  power: 0x30,
  voiceCommand: 0xcf,
  volumeUp: 0xe9,
  volumeDown: 0xea,
  mute: 0xe2,
  /** Direction values for a usage transition. */
  down: 1,
  up: 2,
} as const;
