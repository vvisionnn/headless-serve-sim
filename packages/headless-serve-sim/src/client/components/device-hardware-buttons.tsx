import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { deviceFrameControlRect } from "../device-frame-artwork";
import { hardwareButtonAction, type HardwareButtonAction } from "../utils/hardware-buttons";

export interface HardwareButtonPress {
  button?: string;
  usagePage?: number;
  usage?: number;
  phase?: "down" | "up" | "press";
}

export interface HardwareButtonEntry {
  name: string;
  action: HardwareButtonAction;
  /** Edge of the physical device this control sits on. */
  edge: "left" | "right" | "top" | "bottom";
  /** Fraction (0–1) along that edge, used only to order the list naturally. */
  position: number;
}

/**
 * The hardware buttons a device actually has, read from its DeviceKit artwork.
 *
 * Using the same control data the recording chrome is painted from means a new
 * device body gets the right buttons with no hand-maintained per-device table.
 * Ordered the way they sit on the hardware — left edge top-to-bottom, then
 * right — so the row reads like the device does.
 */
export function hardwareButtonEntries(frame: DeviceFrameSpec | null): HardwareButtonEntry[] {
  const artwork = frame?.artwork;
  if (!artwork) return [];
  const chrome = artwork.chromeRectPx;
  if (chrome.width <= 0 || chrome.height <= 0) return [];

  const entries: HardwareButtonEntry[] = [];
  for (const control of artwork.controls) {
    const action = hardwareButtonAction(control.name);
    if (!action) continue;
    const rect = deviceFrameControlRect(control, artwork);
    const vertical = control.anchor === "left" || control.anchor === "right";
    const span = vertical ? chrome.height : chrome.width;
    if (span <= 0) continue;
    const offset = vertical ? rect.y - chrome.y : rect.x - chrome.x;
    entries.push({
      name: control.name,
      action,
      edge: control.anchor,
      position: Math.min(Math.max(offset / span, 0), 1),
    });
  }

  const edgeOrder = { left: 0, right: 1, top: 2, bottom: 3 } as const;
  return entries.sort((a, b) => edgeOrder[a.edge] - edgeOrder[b.edge] || a.position - b.position);
}

/**
 * Hardware buttons as labelled controls in the simulator toolbar.
 *
 * These used to be transparent hit areas pinned to the frame's edges. That put
 * unlabelled slivers on the device border, which read as visual noise and gave
 * no hint what they did; the toolbar is where the rest of the device controls
 * already live.
 */
export function DeviceHardwareButtons({
  frame,
  onPress,
}: {
  frame: DeviceFrameSpec | null;
  onPress: (press: HardwareButtonPress) => void;
}) {
  const entries = hardwareButtonEntries(frame);
  if (entries.length === 0) return null;

  return (
    <div
      className="flex items-center gap-0.5 rounded-pill border border-divider bg-surface-2 p-0.5"
      role="group"
      aria-label="Hardware buttons"
    >
      {entries.map((entry) => (
        <button
          key={entry.name}
          type="button"
          aria-label={entry.action.label}
          title={entry.action.label}
          onClick={() =>
            onPress({
              ...(entry.action.button ? { button: entry.action.button } : {}),
              ...(entry.action.usagePage !== undefined
                ? { usagePage: entry.action.usagePage }
                : {}),
              ...(entry.action.usage !== undefined ? { usage: entry.action.usage } : {}),
            })
          }
          className="min-h-6 cursor-pointer rounded-pill border-none bg-transparent px-2 text-[11px] font-semibold text-fg-3 hover:bg-hover hover:text-fg-1 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          {shortLabel(entry.action.label)}
        </button>
      ))}
    </div>
  );
}

/** Compact label so a full button row fits beside the other toolbar actions. */
function shortLabel(label: string): string {
  switch (label) {
    case "Volume up":
      return "Vol +";
    case "Volume down":
      return "Vol −";
    case "Ring/Silent":
      return "Ring";
    case "Left side button":
      return "Left";
    case "Side button":
      return "Side";
    default:
      return label;
  }
}
