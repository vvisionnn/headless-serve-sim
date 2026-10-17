import type { MutableRefObject } from "react";
import type {
  ConnectionStats,
  DeviceFrameSpec,
  DeviceType,
  SimulatorRecordingSource,
  StreamConfig,
} from "headless-serve-sim-client/simulator";
import type { DeviceViewTool } from "../components/device-view-tool";
import type { StreamMode } from "../components/stream-mode-toggle";
import type { ScreenRecording } from "../hooks/use-screen-recording";

/** Everything the four Inspector tabs read. client.tsx builds one of these. */
export interface InspectorProps {
  udid: string;
  /** Live exec token; rotates on server restart so tools re-auth. */
  execToken?: string;
  uiSettingsRevision: number;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  foldable: boolean;
  displayId?: number;
  view: Parameters<typeof DeviceViewTool>[0];
  onOrientationChange: (
    orientation: "portrait" | "portrait_upside_down" | "landscape_left" | "landscape_right",
  ) => void;

  // Capture
  recording: ScreenRecording;
  recordingSourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  deviceFrameSpec: DeviceFrameSpec | DeviceType | null;
  streaming: boolean;

  // Activity
  metricsEndpoint: string;
  stream: {
    live: boolean;
    codecMode: "avcc" | "mjpeg";
    streamConfig: StreamConfig;
    sinkRef: MutableRefObject<((snap: ConnectionStats) => void) | null>;
    mode: StreamMode;
    modeAvailable: boolean;
    onModeChange: (mode: StreamMode) => void;
  };
}
