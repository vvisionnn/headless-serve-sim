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
};

/**
 * What pressing a DeviceKit control should send, or null when the control
 * isn't a press at all.
 *
 * `digital-crown` is deliberately excluded: it rotates rather than presses, and
 * is already driven by the wheel handler. Treating it as a button here would
 * put a dead control on the bezel.
 *
 * `action` is excluded too: the Action button has no consumer usage of its own,
 * and the only usage it could ride (menu) is Home — pressing it would leave the
 * app under test rather than do anything Action-specific.
 */
export function hardwareButtonAction(controlName: string): HardwareButtonAction | null {
  return ACTIONS[controlName.toLowerCase()] ?? null;
}

/** Every DeviceKit control name that maps to a press. */
export function pressableControlNames(): string[] {
  return Object.keys(ACTIONS);
}

/** Whether a DeviceKit control should be rendered as a pressable button. */
export function isPressableControl(controlName: string): boolean {
  return hardwareButtonAction(controlName) !== null;
}
