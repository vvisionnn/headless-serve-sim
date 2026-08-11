import type { ReactNode } from "react";
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
 * Glyphs for the physical controls, keyed by DeviceKit control name.
 *
 * Icons rather than text: at most five controls share the right-hand side of a
 * setting row (~200px in the expanded rail), and full labels like "Volume down"
 * wrap to a second line there. A 28px square each keeps every device on one
 * line — five is the worst case, on the classic phone body — and the name still
 * reaches assistive tech and the tooltip.
 */
export const HARDWARE_BUTTON_GLYPHS: Record<string, ReactNode> = {
  "volume-up": (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  "volume-down": (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M5 12h14" />
    </svg>
  ),
  power: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 3v9" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  ),
  mute: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
      <path d="M10.3 21a2 2 0 0 0 3.4 0" />
    </svg>
  ),
  home: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="4" y="4" width="16" height="16" rx="5" />
    </svg>
  ),
  "side-button": (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="3" width="6" height="18" rx="3" />
    </svg>
  ),
  "left-side-button": (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="3" width="6" height="18" rx="3" />
    </svg>
  ),
  action: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  ),
};

/**
 * The device's physical buttons, in the inspector's Simulator section.
 *
 * They began as transparent hit areas pinned to the frame's edges — unlabelled
 * slivers on the device border — then moved to the toolbar, which crowded it.
 * This is where the other device-level controls already live.
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
      className="flex items-center gap-1 rounded-pill border border-divider bg-surface-2 p-0.5"
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
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-fg-3 [transition:background_0.2s,color_0.2s] hover:bg-panel hover:text-fg-1 active:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          {HARDWARE_BUTTON_GLYPHS[entry.name] ?? (
            <span className="text-[11px] font-semibold">?</span>
          )}
        </button>
      ))}
    </div>
  );
}
