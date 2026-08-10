import { HIDUsage } from "./hid-usage";

/**
 * Maps DeviceKit hardware-control names to what the helper should inject.
 *
 * The names come from `chrome.json`'s `inputs` in
 * `/Library/Developer/DeviceKit/Chrome/*.devicechrome`, which is where the
 * bezel artwork and its control rects are already read from for the device
 * frame. Enumerated across the installed chromes, the full set is: action,
 * digital-crown, home, left-side-button, mute, power, side-button,
 * volume-down, volume-up.
 */

export interface HardwareButtonAction {
  /** Existing named button the CLI/helper already understands, if any. */
  button?: string;
  /** Otherwise, the raw USB HID usage to press. */
  usagePage?: number;
  usage?: number;
  /** Accessible label for the control. */
  label: string;
}

/** USB HID Consumer page usages Apple's buttons map onto. */
const CONSUMER = HIDUsage.consumerPage;

const ACTIONS: Record<string, HardwareButtonAction> = {
  home: { button: "home", label: "Home" },
  power: { button: "lock", label: "Power" },
  "side-button": { button: "side_button", label: "Side button" },
  // The left side button is the Ring/Silent switch on iPhone and the
  // back/action control elsewhere; both report through the consumer page.
  "left-side-button": { usagePage: CONSUMER, usage: HIDUsage.mute, label: "Left side button" },
  mute: { usagePage: CONSUMER, usage: HIDUsage.mute, label: "Ring/Silent" },
  "volume-up": { button: "volume_up", label: "Volume up" },
  "volume-down": { button: "volume_down", label: "Volume down" },
  // The Action button has no standard consumer usage; Apple routes it as a
  // programmable control, and the simulator accepts the menu usage for it.
  action: { usagePage: CONSUMER, usage: HIDUsage.menu, label: "Action" },
};

/**
 * What pressing a DeviceKit control should send, or null when the control
 * isn't a press at all.
 *
 * `digital-crown` is deliberately excluded: it rotates rather than presses, and
 * is already driven by the wheel handler. Treating it as a button here would
 * put a dead control on the bezel.
 */
export function hardwareButtonAction(controlName: string): HardwareButtonAction | null {
  return ACTIONS[controlName.toLowerCase()] ?? null;
}

/** Whether a DeviceKit control should be rendered as a pressable button. */
export function isPressableControl(controlName: string): boolean {
  return hardwareButtonAction(controlName) !== null;
}
