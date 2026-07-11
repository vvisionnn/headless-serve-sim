import type { MutableRefObject } from "react";
import type {
  DeviceType,
  SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import { LocationEmulationTool } from "../location-emulation-tool";
import { execOnHost } from "../utils/exec";
import { AppActionsTool } from "./app-actions-tool";
import { AppDetectionTool } from "./app-detection-tool";
import { AppPermissionsTool } from "./app-permissions-tool";
import { AxTreeTool } from "./ax-tree-tool";
import { CameraTool } from "./camera-tool";
import { ImportDocumentTool } from "./import-document-tool";
import { ScreenshotTool } from "./screenshot-tool";
import { ScreenRecordingTool } from "./screen-recording-tool";
import { SimulatorSettingsTool } from "./simulator-settings-tool";
import { StatusBarTool } from "./status-bar-tool";
import { UserDefaultsTool } from "./user-defaults-tool";

// The full-height right inspector. Collapsed by default to a thin rail whose top
// header matches the top bar. The content panel is laid out at the FULL expanded
// width at all times and anchored to the right edge; expanding just animates the
// rail's width (revealing the panel) while the body fades + slides in — so it
// reads as a panel sliding out, never as content reflowing mid-animation.

export interface InspectorBarProps {
  open: boolean;
  onToggle: () => void;
  collapsedWidth: number;
  expandedWidth: number;
  topBarHeight: number;
  frameHeight: number;
  openOverlay: "stats" | "logs" | "grid" | "devtools" | null;
  udid: string;
  deviceType: DeviceType;
  streaming: boolean;
  recordingSourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  /** Live exec token; rotates on server restart so the settings tool re-auths. */
  execToken?: string;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  axOverlayEnabled: boolean;
  onToggleAxOverlay: () => void;
  onOpenStats: () => void;
  onOpenLogs: () => void;
  onOpenGrid: () => void;
  onOpenDevtools: () => void;
}

// Apple's restrained decelerate curve, shared with the device frame so the two
// animate in lockstep when the inspector expands/collapses. No spring/overshoot.
const EASE = "cubic-bezier(0.4, 0, 0.6, 1)";

export function InspectorBar({
  open,
  onToggle,
  collapsedWidth,
  expandedWidth,
  topBarHeight,
  frameHeight,
  openOverlay,
  udid,
  deviceType,
  streaming,
  recordingSourceRef,
  execToken,
  currentApp,
  axOverlayEnabled,
  onToggleAxOverlay,
  onOpenStats,
  onOpenLogs,
  onOpenGrid,
  onOpenDevtools,
}: InspectorBarProps) {
  const height = topBarHeight + frameHeight;
  return (
    <aside
      className="relative shrink-0 overflow-hidden bg-panel border-l border-divider font-system"
      style={{
        width: open ? expandedWidth : collapsedWidth,
        height,
        transition: `width 320ms ${EASE}`,
      }}
      aria-label="Inspector"
    >
      {/* Fixed-width panel anchored to the right edge — never reflows; the rail
          width animation reveals it. */}
      <div
        className="absolute top-0 right-0 flex flex-col"
        style={{ width: expandedWidth, height }}
      >
        {/* Header — frosted, same height + bottom keyline as the top bar. Title
            at the left, toggle at the right so it stays in the collapsed rail
            (which reveals the panel's right edge). */}
        <div
          className="flex items-center justify-between shrink-0 border-b border-divider px-1 bg-panel-overlay [backdrop-filter:saturate(1.8)_blur(20px)]"
          style={{ height: topBarHeight }}
        >
          <span className="ml-2.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" />
              <line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" />
              <line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" />
              <line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" />
            </svg>
            Inspector
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="flex size-9 items-center justify-center rounded-full bg-transparent text-fg-2 hover:bg-hover hover:text-fg [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)] cursor-pointer focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
            aria-label={open ? "Collapse inspector" : "Expand inspector"}
            aria-expanded={open}
            title="Inspector"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: open ? "none" : "rotate(180deg)" }}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        {/* Body — grouped white cards on a gray canvas with breathing room, so
            each tool reads as a distinct section. Fades + slides as a unit. */}
        <div
          className="flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden bg-inset p-3.5 [&>*]:shrink-0"
          aria-hidden={!open}
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateX(0)" : "translateX(28px)",
            pointerEvents: open ? "auto" : "none",
            transition: `opacity 260ms ${EASE}, transform 320ms ${EASE}`,
          }}
        >
          <AppDetectionTool udid={udid} currentApp={currentApp} />
          <SimulatorSettingsTool udid={udid} execToken={execToken} />
          <AxTreeTool overlayEnabled={axOverlayEnabled} onToggleOverlay={onToggleAxOverlay} />
          <CameraTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <ScreenshotTool udid={udid} />
          <ScreenRecordingTool
            sourceRef={recordingSourceRef}
            deviceType={deviceType}
            deviceKey={udid}
            streaming={streaming}
          />
          <ImportDocumentTool udid={udid} />
          <LocationEmulationTool udid={udid} exec={execOnHost} />
          <StatusBarTool udid={udid} />
          <UserDefaultsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <AppActionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <AppPermissionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />

          <InspectorLauncher label="Connection Stats" onClick={onOpenStats} expanded={openOverlay === "stats"} />
          <InspectorLauncher label="Logs" onClick={onOpenLogs} expanded={openOverlay === "logs"} />
          <InspectorLauncher label="Simulators" onClick={onOpenGrid} expanded={openOverlay === "grid"} />
          <InspectorLauncher label="WebKit DevTools" onClick={onOpenDevtools} expanded={openOverlay === "devtools"} />
        </div>
      </div>
    </aside>
  );
}

function InspectorLauncher({
  label,
  onClick,
  expanded,
}: {
  label: string;
  onClick: () => void;
  expanded: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-card border border-divider bg-panel px-3.5 py-3 text-left text-[13px] font-medium text-fg hover:bg-hover [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
    >
      <span>{label}</span>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-fg-3 shrink-0"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
