import type { MutableRefObject } from "react";
import type {
  DeviceType,
  DeviceFrameSpec,
  SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import { LocationEmulationTool } from "../location-emulation-tool";
import { execOnHost } from "../utils/exec";
import { AppActionsTool } from "./app-actions-tool";
import { AppDetectionTool } from "./app-detection-tool";
import { AppPermissionsTool } from "./app-permissions-tool";
import { AxTreeTool } from "./ax-tree-tool";
import { CameraTool } from "./camera-tool";
import { PanelToggleIcon, SectionGroup, SquareIconButton } from "./design-system";
import { ImportDocumentTool } from "./import-document-tool";
import { ScreenshotTool } from "./screenshot-tool";
import { ScreenRecordingTool } from "./screen-recording-tool";
import type { StreamMode } from "./stream-mode-toggle";
import { SimulatorSettingsTool } from "./simulator-settings-tool";
import { StatusBarTool } from "./status-bar-tool";
import { UserDefaultsTool } from "./user-defaults-tool";

// The inspector card. Collapsed by default to a thin rail whose top header
// still reads as the card's title row. The content panel is laid out at the
// FULL expanded width at all times and anchored to the right edge; expanding
// just animates the card's width (revealing the panel) while the body fades +
// slides in — so it reads as a panel sliding out, never as content reflowing
// mid-animation.

export interface InspectorBarProps {
  open: boolean;
  onToggle: () => void;
  collapsedWidth: number;
  expandedWidth: number;
  topBarHeight: number;
  /** Full card height — the inspector spans the canvas, not the device. */
  height: number;
  openOverlay: "stats" | "logs" | "grid" | "devtools" | null;
  udid: string;
  deviceFrameSpec: DeviceFrameSpec | DeviceType | null;
  streaming: boolean;
  streamMode: StreamMode;
  streamModeAvailable: boolean;
  onStreamModeChange: (mode: StreamMode) => void;
  recordingSourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  /** Live exec token; rotates on server restart so the settings tool re-auths. */
  execToken?: string;
  uiSettingsRevision: number;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  axOverlayEnabled: boolean;
  onToggleAxOverlay: () => void;
  onOpenStats: () => void;
  onOpenLogs: () => void;
  onOpenGrid: () => void;
  onOpenDevtools: () => void;
}

// Restrained decelerate curve, shared with the device so the two animate in
// lockstep when the inspector expands/collapses. No spring/overshoot.
const EASE = "cubic-bezier(0.4, 0, 0.6, 1)";

export function InspectorBar({
  open,
  onToggle,
  collapsedWidth,
  expandedWidth,
  topBarHeight,
  height,
  openOverlay,
  udid,
  deviceFrameSpec,
  streaming,
  streamMode,
  streamModeAvailable,
  onStreamModeChange,
  recordingSourceRef,
  execToken,
  uiSettingsRevision,
  currentApp,
  axOverlayEnabled,
  onToggleAxOverlay,
  onOpenStats,
  onOpenLogs,
  onOpenGrid,
  onOpenDevtools,
}: InspectorBarProps) {
  return (
    <aside
      className="relative shrink-0 overflow-hidden rounded-panel bg-panel shadow-panel font-system"
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
        {/* Title row. The toggle sits at the right so it stays inside the
            collapsed rail (which reveals the panel's right edge). */}
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-[9px]"
          style={{ height: topBarHeight }}
        >
          <span className="ml-3 truncate text-eyebrow uppercase text-fg">Inspector</span>
          <SquareIconButton
            onClick={onToggle}
            label={open ? "Collapse inspector" : "Expand inspector"}
            title="Inspector"
          >
            <PanelToggleIcon side="right" open={open} />
          </SquareIconButton>
        </div>

        {/* Body — flat sections on white, separated by hairline rules rather
            than by gutters. Fades + slides as a unit. */}
        {/* Body — sections grouped by WHAT THEY ACT ON, divided by hairline
            rules. Sixteen tools as flat peers is a list, not an interface.
            Fades + slides as a unit. */}
        <div
          className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden bg-inset [&>*]:shrink-0"
          aria-hidden={!open}
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateX(0)" : "translateX(28px)",
            pointerEvents: open ? "auto" : "none",
            transition: `opacity 260ms ${EASE}, transform 320ms ${EASE}`,
          }}
        >
          {/* Context, not a tool — what everything below is currently acting on. */}
          <AppDetectionTool udid={udid} currentApp={currentApp} />

          <SectionGroup label="Device">
            <SimulatorSettingsTool
              udid={udid}
              execToken={execToken}
              refreshKey={uiSettingsRevision}
            />
            <StatusBarTool udid={udid} />
            <LocationEmulationTool udid={udid} exec={execOnHost} />
            <CameraTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          </SectionGroup>

          <SectionGroup label="App">
            <AppActionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
            <AppPermissionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
            <UserDefaultsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
            <ImportDocumentTool udid={udid} />
          </SectionGroup>

          <SectionGroup label="Capture">
            <ScreenshotTool udid={udid} />
            <ScreenRecordingTool
              sourceRef={recordingSourceRef}
              deviceFrameSpec={deviceFrameSpec}
              deviceKey={udid}
              streaming={streaming}
              streamMode={streamMode}
              streamModeAvailable={streamModeAvailable}
              onStreamModeChange={onStreamModeChange}
            />
          </SectionGroup>

          <SectionGroup label="Inspect">
            <AxTreeTool overlayEnabled={axOverlayEnabled} onToggleOverlay={onToggleAxOverlay} />
            <InspectorLauncher
              label="Connection Stats"
              onClick={onOpenStats}
              expanded={openOverlay === "stats"}
            />
            <InspectorLauncher
              label="Logs"
              onClick={onOpenLogs}
              expanded={openOverlay === "logs"}
            />
            <InspectorLauncher
              label="WebKit DevTools"
              onClick={onOpenDevtools}
              expanded={openOverlay === "devtools"}
            />
            <InspectorLauncher
              label="Simulators"
              onClick={onOpenGrid}
              expanded={openOverlay === "grid"}
            />
          </SectionGroup>
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
      className="flex w-full cursor-pointer items-center justify-between gap-2 border-t border-divider bg-transparent px-5 py-3.5 text-left text-body text-fg hover:bg-hover [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
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
