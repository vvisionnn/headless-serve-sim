import type { CSSProperties } from "react";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { deviceFrameControlRect } from "../device-frame-artwork";
import { hardwareButtonAction, type HardwareButtonAction } from "../utils/hardware-buttons";

export interface HardwareButtonPress {
  button?: string;
  usagePage?: number;
  usage?: number;
  phase?: "down" | "up" | "press";
}

/** Where a control sits, as a fraction along the edge it's anchored to. */
export interface HardwareButtonPlacement {
  name: string;
  action: HardwareButtonAction;
  edge: "left" | "right" | "top" | "bottom";
  /** Fraction (0–1) along the edge of the control's leading corner. */
  start: number;
  /** Fraction (0–1) of the edge the control spans. */
  length: number;
}

/**
 * Positions for a device's hardware buttons, derived from DeviceKit artwork.
 *
 * The same control rects the recording chrome is painted from decide which
 * buttons exist and where they sit, so a new device body gets correct buttons
 * without a hand-maintained per-device table.
 *
 * Exported separately from the component so the geometry is testable.
 */
export function hardwareButtonPlacements(frame: DeviceFrameSpec | null): HardwareButtonPlacement[] {
  const artwork = frame?.artwork;
  if (!artwork) return [];
  const chrome = artwork.chromeRectPx;
  if (chrome.width <= 0 || chrome.height <= 0) return [];

  const placements: HardwareButtonPlacement[] = [];
  for (const control of artwork.controls) {
    const action = hardwareButtonAction(control.name);
    if (!action) continue;
    const rect = deviceFrameControlRect(control, artwork);
    const vertical = control.anchor === "left" || control.anchor === "right";
    const span = vertical ? chrome.height : chrome.width;
    if (span <= 0) continue;
    const offset = vertical ? rect.y - chrome.y : rect.x - chrome.x;
    const size = vertical ? rect.height : rect.width;
    placements.push({
      name: control.name,
      action,
      edge: control.anchor,
      // Clamp so a control whose artwork extends past the screen opening still
      // lands on the edge rather than off-screen.
      start: Math.min(Math.max(offset / span, 0), 1),
      length: Math.min(Math.max(size / span, 0.02), 1),
    });
  }
  return placements;
}

/**
 * Interactive hardware buttons along the edges of the live stream.
 *
 * The preview draws the stream edge-to-edge rather than inside a rendered
 * bezel, so these sit as tabs on the frame's edges at the position DeviceKit
 * gives for the physical control, instead of on top of a drawn button.
 */
export function DeviceHardwareButtons({
  frame,
  onPress,
}: {
  frame: DeviceFrameSpec | null;
  onPress: (press: HardwareButtonPress) => void;
}) {
  const placements = hardwareButtonPlacements(frame);
  if (placements.length === 0) return null;

  return (
    <>
      {placements.map((placement) => {
        const vertical = placement.edge === "left" || placement.edge === "right";
        const thickness = 5;
        const style: CSSProperties = {
          position: "absolute",
          ...(vertical
            ? {
                top: `${placement.start * 100}%`,
                height: `${placement.length * 100}%`,
                width: thickness,
                [placement.edge]: 0,
              }
            : {
                left: `${placement.start * 100}%`,
                width: `${placement.length * 100}%`,
                height: thickness,
                [placement.edge]: 0,
              }),
          borderRadius: thickness,
          border: "none",
          padding: 0,
          cursor: "pointer",
          background: "var(--color-divider)",
        };
        return (
          <button
            key={placement.name}
            type="button"
            aria-label={placement.action.label}
            title={placement.action.label}
            style={style}
            className="z-10 opacity-70 hover:opacity-100 hover:bg-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
            onClick={() =>
              onPress({
                ...(placement.action.button ? { button: placement.action.button } : {}),
                ...(placement.action.usagePage !== undefined
                  ? { usagePage: placement.action.usagePage }
                  : {}),
                ...(placement.action.usage !== undefined ? { usage: placement.action.usage } : {}),
              })
            }
          />
        );
      })}
    </>
  );
}
