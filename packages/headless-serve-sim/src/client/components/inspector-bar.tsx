import { LocationEmulationTool } from "../location-emulation-tool";
import { execOnHost } from "../utils/exec";
import { AppActionsTool } from "./app-actions-tool";
import { AppDetectionTool } from "./app-detection-tool";
import { AppPermissionsTool } from "./app-permissions-tool";
import { AxTreeTool } from "./ax-tree-tool";
import { CameraTool } from "./camera-tool";
import { ImportDocumentTool } from "./import-document-tool";
import { ScreenshotTool } from "./screenshot-tool";
import { SimulatorSettingsTool } from "./simulator-settings-tool";
import { StatusBarTool } from "./status-bar-tool";
import { UserDefaultsTool } from "./user-defaults-tool";

// The full-height right inspector. Collapsed by default to a thin rail whose
// top header matches the top bar (same height + bottom keyline). Expanding
// reveals the consolidated tool blocks (stacked, hairline-divided) plus
// launchers for the wide surfaces (Connection Stats, Simulators grid, WebKit
// DevTools) that need real width and keep their existing overlay behavior.

export interface InspectorBarProps {
  open: boolean;
  onToggle: () => void;
  collapsedWidth: number;
  expandedWidth: number;
  topBarHeight: number;
  frameHeight: number;
  openOverlay: "stats" | "grid" | "devtools" | null;
  udid: string;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  axOverlayEnabled: boolean;
  onToggleAxOverlay: () => void;
  onOpenStats: () => void;
  onOpenGrid: () => void;
  onOpenDevtools: () => void;
}

// Springy width easing (gentle overshoot) shared with the device frame so the
// two animate in lockstep when the inspector expands/collapses.
const MOTION = "width 340ms cubic-bezier(0.34, 1.3, 0.6, 1)";

export function InspectorBar({
  open,
  onToggle,
  collapsedWidth,
  expandedWidth,
  topBarHeight,
  frameHeight,
  openOverlay,
  udid,
  currentApp,
  axOverlayEnabled,
  onToggleAxOverlay,
  onOpenStats,
  onOpenGrid,
  onOpenDevtools,
}: InspectorBarProps) {
  return (
    <aside
      className="relative shrink-0 flex flex-col bg-panel border-l border-divider overflow-hidden font-system"
      style={{
        width: open ? expandedWidth : collapsedWidth,
        height: topBarHeight + frameHeight,
        transition: MOTION,
      }}
      aria-label="Inspector"
    >
      {/* Header — same height + bottom keyline as the top bar (single hairline grid). */}
      <div
        className="flex items-center justify-center shrink-0 border-b border-divider"
        style={{ height: topBarHeight }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex h-full w-11 items-center justify-center bg-transparent text-fg-2 hover:bg-hover hover:text-fg [transition:background_0.15s,color_0.15s] cursor-pointer focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent)]"
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

      {/* Body — only mounted when expanded so collapsed is a clean rail. */}
      {open && (
        <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <AppDetectionTool udid={udid} currentApp={currentApp} />
          <SimulatorSettingsTool udid={udid} />
          <AxTreeTool overlayEnabled={axOverlayEnabled} onToggleOverlay={onToggleAxOverlay} />
          <CameraTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <ScreenshotTool udid={udid} />
          <ImportDocumentTool udid={udid} />
          <LocationEmulationTool udid={udid} exec={execOnHost} />
          <StatusBarTool udid={udid} />
          <UserDefaultsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <AppActionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <AppPermissionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />

          <InspectorLauncher label="Connection Stats" onClick={onOpenStats} expanded={openOverlay === "stats"} />
          <InspectorLauncher label="Simulators" onClick={onOpenGrid} expanded={openOverlay === "grid"} />
          <InspectorLauncher label="WebKit DevTools" onClick={onOpenDevtools} expanded={openOverlay === "devtools"} />
        </div>
      )}
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
      className="flex w-full cursor-pointer items-center justify-between border-b border-divider bg-transparent px-2 py-1.5 text-left text-[13px] text-fg hover:bg-hover [transition:background_0.15s] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent)]"
    >
      <span>{label}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-fg-3"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
