import { CameraTool } from "../components/camera-tool";
import { DeviceViewTool } from "../components/device-view-tool";
import { SimulatorControlsTool } from "../components/simulator-controls-tool";
import { SimulatorSettingsTool } from "../components/simulator-settings-tool";
import { StatusBarTool } from "../components/status-bar-tool";
import { LocationEmulationTool } from "../location-emulation-tool";
import { execOnHost } from "../utils/exec";
import type { InspectorProps } from "./types";

/**
 * Device tab: how the simulator looks and behaves. Always-on settings sit in
 * grouped sections up top; occasional tools fold away into disclosures below.
 */
export function DeviceTab({
  udid,
  execToken,
  uiSettingsRevision,
  currentApp,
  foldable,
  view,
  onOrientationChange,
}: InspectorProps) {
  return (
    <>
      <SimulatorSettingsTool udid={udid} execToken={execToken} refreshKey={uiSettingsRevision} />
      <DeviceViewTool {...view} />
      {foldable && (
        <SimulatorControlsTool
          udid={udid}
          execToken={execToken}
          onOrientationChange={onOrientationChange}
        />
      )}
      <StatusBarTool udid={udid} />
      <LocationEmulationTool udid={udid} exec={execOnHost} />
      <CameraTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
    </>
  );
}
