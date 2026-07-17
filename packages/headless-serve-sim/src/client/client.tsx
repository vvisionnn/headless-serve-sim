import { createRoot } from "react-dom/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  SimulatorView,
  displayStreamConfig,
  fallbackScreenSize,
  SimulatorToolbar,
  getDeviceType,
  matchDeviceFrameSpec,
  parseServerStreamStats,
  simulatorMaxWidth,
  type DeviceType,
  type DeviceFrameSpec,
  type SimulatorOrientation,
  type StreamConfig,
  type ConnectionStats,
  type ServerStreamStats,
  type SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";

import { AppearanceIcon, ReloadIcon } from "./icons";
import { AxDomOverlay } from "./components/ax-dom-overlay";
import { AxStateProvider } from "./components/ax-state-provider";
import { AxToolbarButton } from "./components/ax-toolbar-button";
import { BootEmptyState } from "./components/boot-empty-state";
import { SimulatorDisconnected } from "./components/simulator-disconnected";
import { DevicePicker } from "./components/device-picker";
import { GridPanel } from "./components/grid-panel";
import { MetricsBar } from "./components/metrics-bar";
import { ConnectionStatsPanel } from "./components/connection-stats-panel";
import { ResizeHandle } from "./components/resize-handle";
import { InspectorBar } from "./components/inspector-bar";
import { LogsPanel } from "./components/logs-panel";
import { WebKitDevtoolsPanel } from "./components/webkit-devtools-panel";
import { useMediaDrop } from "./hooks/use-media-drop";
import { useMjpegStream } from "./hooks/use-mjpeg-stream";
import { useAvccStream } from "./hooks/use-avcc-stream";
import { useResizableWidth } from "./hooks/use-resizable-width";
import { useUploadToasts } from "./hooks/use-upload-toasts";
import { useWebKitDevtools } from "./hooks/use-webkit-devtools";
import {
  avccFallbackReducer,
  initialAvccFallback,
  AVCC_FRAME_TIMEOUT_MS,
} from "./avcc-fallback";
import { parseSimctlList, type SimDevice } from "./utils/devices";
import { fileExtension } from "./utils/drop";
import { execOnHost } from "./utils/exec";
import { hidUsageForCode } from "./utils/hid";
import {
  CONNECTION_STATS_PANEL_WIDTH,
  DEVTOOLS_PANEL_WIDTH,
  GRID_PANEL_WIDTH,
  LOGS_PANEL_WIDTH,
} from "./utils/panel-widths";
import { captureScreenshot, downloadScreenshot, screenshotFilename } from "./utils/screenshot";
import { simEndpoint } from "./utils/sim-endpoint";
import { SIMULATOR_RESIZE_MAX_SCALE } from "./utils/simulator-resize";
import { fitDeviceFrame } from "./utils/frame-geometry";
import { resolveActiveScreenConfig } from "./utils/screen-config";
import { readPersistedFlag, writePersistedFlag } from "./utils/persisted-flag";
import { resolveEventsDevice } from "./utils/events-device";
import { previewConfigKey } from "./utils/preview-config";
import {
  currentAppForDevice,
  type DetectedAppState,
} from "./utils/current-app";
import {
  reconcileStreamMode,
  sendStreamMode,
  type PendingStreamMode,
  type StreamMode,
} from "./utils/stream-mode-control";

// Counter-clockwise cycle, matching Simulator.app's Cmd+Left ("Rotate Left").
const ROTATE_LEFT_CYCLE: Record<SimulatorOrientation, SimulatorOrientation> = {
  portrait: "landscape_left",
  landscape_left: "portrait_upside_down",
  portrait_upside_down: "landscape_right",
  landscape_right: "portrait",
};
const ROTATE_RIGHT_CYCLE: Record<SimulatorOrientation, SimulatorOrientation> = {
  portrait: "landscape_right",
  landscape_right: "portrait_upside_down",
  portrait_upside_down: "landscape_left",
  landscape_left: "portrait",
};

// ─── App ───

// Boolean UI flag persisted to localStorage, so a rail's expanded/collapsed
// state survives a reload. Reads once on mount; writes on every change.
function usePersistedFlag(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => readPersistedFlag(key, fallback));
  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
        writePersistedFlag(key, v);
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

type PreviewConfig = NonNullable<Window["__SIM_PREVIEW__"]>;


function App() {
  const [config, setConfig] = useState<PreviewConfig | null>(() => window.__SIM_PREVIEW__ ?? null);
  const [streaming, setStreaming] = useState(false);
  const [devices, setDevices] = useState<SimDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [stoppingUdids, setStoppingUdids] = useState<Set<string>>(new Set());
  const [switching, setSwitching] = useState(false);
  const [axOverlayEnabled, setAxOverlayEnabled] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [selectedDevtoolsTargetId, setSelectedDevtoolsTargetId] = useState<string | null>(null);

  // Auto-connect preference (browser-local, default OFF). When OFF the stream is
  // pinned to the selected simulator: if it disconnects the view waits for the
  // SAME device instead of hopping to whichever simulator is booted. When ON the
  // legacy behavior is kept (the server may fall back to any booted helper).
  const [autoConnect, setAutoConnect] = usePersistedFlag("headless-serve-sim:auto-connect", false);
  const [showPicker, setShowPicker] = useState(false);
  const [lastDevice, setLastDevice] = useState<{ udid: string; name: string | null } | null>(() => {
    const p = window.__SIM_PREVIEW__;
    return p ? { udid: p.device, name: p.deviceName ?? null } : null;
  });
  // The URL's ?device= is captured once at mount; the OFF-mode pin otherwise
  // tracks the simulator we're actually viewing (`lastDevice`). Deriving the pin
  // from the live committed device — not a mount-time snapshot — means toggling
  // OFF after an auto-connect hop, or a device that first appears out-of-band,
  // pins the CURRENT simulator rather than a stale one.
  const urlDeviceRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get("device"),
  );
  const eventsDevice = resolveEventsDevice({
    autoConnect,
    urlDevice: urlDeviceRef.current,
    initialDevice: lastDevice?.udid ?? null,
  });

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const res = await execOnHost("xcrun simctl list devices available -j");
      if (res.exitCode !== 0) throw new Error(res.stderr || "simctl list failed");
      setDevices(parseSimctlList(res.stdout));
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : "Failed to list devices");
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // Refresh the device list whenever a new simulator is committed, so its name
  // is known (e.g. for the disconnected panel) even if it first appeared
  // out-of-band after load. Guarded on a live device: with no stream there's no
  // exec token to authenticate the list call.
  useEffect(() => {
    if (config?.device) void fetchDevices();
  }, [config?.device, fetchDevices]);

  useEffect(() => {
    // Pin the subscription to `eventsDevice` so the server streams only that
    // simulator (or null once it's gone) — never a different booted one. When
    // the auto-connect toggle flips, `eventsDevice` changes and we re-subscribe.
    const eventsUrl = `${simEndpoint("api/events")}${eventsDevice ? `?device=${encodeURIComponent(eventsDevice)}` : ""}`;

    const applyConfig = (next: PreviewConfig | null) => {
      setConfig((prev) => {
        if (previewConfigKey(prev) === previewConfigKey(next)) return prev;
        if (next) window.__SIM_PREVIEW__ = next;
        else delete window.__SIM_PREVIEW__;
        return next;
      });
    };

    // Server pushes the headless-serve-sim state only when it actually changes (helper
    // boot/shutdown or device selection), so there's no polling loop here.
    const es = new EventSource(eventsUrl);
    es.onmessage = (event) => {
      try {
        applyConfig(JSON.parse(event.data) as PreviewConfig | null);
      } catch {}
    };
    return () => es.close();
  }, [eventsDevice]);

  // Remember the last simulator we actually streamed so the disconnected panel
  // can name it, and drop the manual picker once a stream comes back.
  useEffect(() => {
    if (!config) return;
    setLastDevice({ udid: config.device, name: config.deviceName ?? null });
    setShowPicker(false);
  }, [config]);

  if (!config) {
    // Auto-connect OFF and a device we were streaming just went away: wait for
    // the SAME simulator rather than hopping to another booted one. The manual
    // "choose another" escape falls through to the boot picker.
    if (!autoConnect && lastDevice && !showPicker) {
      // The SSE-pushed config omits deviceName, so prefer the live device list
      // (which knows the name of any booted/shutdown sim) and fall back to the
      // name captured when we last had a config.
      const name = devices.find((d) => d.udid === lastDevice.udid)?.name ?? lastDevice.name;
      return (
        <SimulatorDisconnected
          deviceName={name}
          onChooseAnother={() => setShowPicker(true)}
          autoConnect={autoConnect}
          onAutoConnectChange={setAutoConnect}
          canAutoConnect={!urlDeviceRef.current}
        />
      );
    }
    return (
      <BootEmptyState
        devices={devices}
        loading={devicesLoading}
        error={devicesError}
        onRefresh={fetchDevices}
      />
    );
  }

  return (
    <AppWithConfig
      config={config}
      devices={devices}
      devicesLoading={devicesLoading}
      devicesError={devicesError}
      stoppingUdids={stoppingUdids}
      setStoppingUdids={setStoppingUdids}
      switching={switching}
      setSwitching={setSwitching}
      axOverlayEnabled={axOverlayEnabled}
      setAxOverlayEnabled={setAxOverlayEnabled}
      devtoolsOpen={devtoolsOpen}
      setDevtoolsOpen={setDevtoolsOpen}
      gridOpen={gridOpen}
      setGridOpen={setGridOpen}
      selectedDevtoolsTargetId={selectedDevtoolsTargetId}
      setSelectedDevtoolsTargetId={setSelectedDevtoolsTargetId}
      streaming={streaming}
      setStreaming={setStreaming}
      fetchDevices={fetchDevices}
      autoConnect={autoConnect}
      setAutoConnect={setAutoConnect}
    />
  );
}

interface AppWithConfigProps {
  config: PreviewConfig;
  devices: SimDevice[];
  devicesLoading: boolean;
  devicesError: string | null;
  stoppingUdids: Set<string>;
  setStoppingUdids: React.Dispatch<React.SetStateAction<Set<string>>>;
  switching: boolean;
  setSwitching: (v: boolean) => void;
  axOverlayEnabled: boolean;
  setAxOverlayEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  devtoolsOpen: boolean;
  setDevtoolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  gridOpen: boolean;
  setGridOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDevtoolsTargetId: string | null;
  setSelectedDevtoolsTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  streaming: boolean;
  setStreaming: (v: boolean) => void;
  fetchDevices: () => Promise<void>;
  autoConnect: boolean;
  setAutoConnect: (next: boolean) => void;
}

function AppWithConfig({
  config,
  devices,
  devicesLoading,
  devicesError,
  stoppingUdids,
  setStoppingUdids,
  switching,
  setSwitching,
  axOverlayEnabled,
  setAxOverlayEnabled,
  devtoolsOpen,
  setDevtoolsOpen,
  gridOpen,
  setGridOpen,
  selectedDevtoolsTargetId,
  setSelectedDevtoolsTargetId,
  streaming,
  setStreaming,
  fetchDevices,
  autoConnect,
  setAutoConnect,
}: AppWithConfigProps) {
  const selectedDevice = devices.find((d) => d.udid === config.device) ?? null;
  // Prefer the live device-list name; fall back to the name baked into
  // __SIM_PREVIEW__ so the device type — and thus the frame's size cap — is
  // correct on the first paint, before the async `simctl list` resolves.
  const resolvedDeviceName = selectedDevice?.name ?? config.deviceName ?? null;

  useEffect(() => {
    document.title = selectedDevice?.name
      ? `Simulator - ${selectedDevice.name}`
      : "Simulator Preview";
  }, [selectedDevice?.name]);

  const deviceType: DeviceType = config.deviceFrameSpec?.family ?? getDeviceType(
    selectedDevice?.deviceTypeIdentifier ?? config.deviceTypeIdentifier ?? resolvedDeviceName,
  );
  const devtools = useWebKitDevtools(config.devtoolsEndpoint ?? simEndpoint("devtools"), devtoolsOpen);

  useEffect(() => {
    if (!devtoolsOpen) return;
    if (selectedDevtoolsTargetId && devtools.targets.some((target) => target.id === selectedDevtoolsTargetId)) return;
    setSelectedDevtoolsTargetId(devtools.targets.length === 1 ? devtools.targets[0]!.id : null);
  }, [devtoolsOpen, devtools.targets, selectedDevtoolsTargetId, setSelectedDevtoolsTargetId]);

  useEffect(() => {
    setSelectedDevtoolsTargetId(null);
  }, [config.device, setSelectedDevtoolsTargetId]);

  // Prefer H.264 (AVCC via WebCodecs) when the browser supports it; otherwise
  // fall back to MJPEG. The MJPEG reader stays dormant (null url) under AVCC so
  // we never pull both streams at once. The AVCC frames are decoded view-side
  // by SimulatorView's `useAvccStream`; this hook just reports browser support.
  //
  // Browser support is necessary but not sufficient: the helper may not serve
  // `/stream.avcc` at all. A device started from the UI is spawned via
  // `bunx headless-serve-sim --detach`, which runs the published `headless-serve-sim` — older
  // versions predate H.264 and 404 the endpoint (cross-origin that 404 is
  // opaque to fetch, so "no frame arrived" is the only reliable signal).
  // `avccFallback` drives a startup timeout: if AVCC paints nothing in time,
  // drop to MJPEG, which every helper serves. See avcc-fallback.ts.
  const avcc = useAvccStream();
  const [avccFallback, dispatchAvccFallback] = useReducer(
    avccFallbackReducer,
    initialAvccFallback,
  );
  const useAvccVideo = avcc.supported && !avccFallback.fellBack;
  const mjpeg = useMjpegStream(useAvccVideo ? null : config.streamUrl);

  // Re-arm AVCC whenever the target stream changes (device switch / reconnect).
  useEffect(() => {
    setStreaming(false);
    dispatchAvccFallback("reset");
  }, [config.streamUrl, setStreaming]);
  // `streaming` flips true on the first painted AVCC frame (JPEG seed decodes
  // sub-second on a healthy helper), which cancels the fallback.
  useEffect(() => {
    if (useAvccVideo && streaming) dispatchAvccFallback("frame");
  }, [useAvccVideo, streaming]);
  // One-shot startup window; on expiry fall back unless a frame already landed.
  useEffect(() => {
    if (!useAvccVideo) return;
    const timer = setTimeout(
      () => dispatchAvccFallback("timeout"),
      AVCC_FRAME_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [useAvccVideo, config.streamUrl]);
  const [liveStreamConfig, setLiveStreamConfig] = useState<StreamConfig | null>(null);
  // Screen config now arrives over the input WebSocket (pushed by the helper on
  // connect + on every dimension/orientation change) instead of a 1s /config poll.
  const [wsStreamConfig, setWsStreamConfig] = useState<StreamConfig | null>(null);
  const streamConfig = wsStreamConfig;
  const activeStreamConfig = resolveActiveScreenConfig({
    live: liveStreamConfig,
    ws: streamConfig,
    injected: config.screenConfig,
    fallback: config.deviceFrameSpec?.nativeScreen ?? fallbackScreenSize(deviceType, resolvedDeviceName),
  });
  const recordingDeviceFrameSpec: DeviceFrameSpec | DeviceType | null = config.deviceFrameSpec
    ? matchDeviceFrameSpec({
        deviceTypeIdentifier:
          selectedDevice?.deviceTypeIdentifier ?? config.deviceTypeIdentifier,
        modelName: config.deviceFrameSpec.modelName,
        family: deviceType === "vision" ? null : deviceType,
      }, activeStreamConfig, [config.deviceFrameSpec]).spec ??
        (deviceType === "vision" ? null : deviceType)
    : deviceType === "vision" ? null : deviceType;
  const frameMaxWidth = simulatorMaxWidth(deviceType, activeStreamConfig);
  const frameDisplayConfig = displayStreamConfig(activeStreamConfig);
  const frameAspectRatioValue = frameDisplayConfig
    ? frameDisplayConfig.width / frameDisplayConfig.height
    : 1;

  // Touch/button relay via direct WebSocket
  const [streamMode, setStreamMode] = useState<StreamMode>("perf");
  const pendingStreamModeRef = useRef<PendingStreamMode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentWs: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    };

    const connect = () => {
      const ws = new WebSocket(config.wsUrl);
      ws.binaryType = "arraybuffer";
      currentWs = ws;
      wsRef.current = ws;
      ws.onopen = () => {
        const pending = pendingStreamModeRef.current;
        if (pending) sendStreamMode(ws, pending.mode);
      };
      ws.onmessage = (ev) => {
        // Server -> client pushes: [tag][JSON]. 0x82 = screen-config,
        // 0x83 = adaptive stream-stats (mode/target-bitrate/congestion).
        if (!(ev.data instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(ev.data);
        if (bytes.length < 1) return;
        if (bytes[0] === 0x82) {
          try {
            const cfg = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as StreamConfig;
            if (cfg.width <= 0 || cfg.height <= 0) return;
            setWsStreamConfig((prev) =>
              prev &&
              prev.width === cfg.width &&
              prev.height === cfg.height &&
              prev.orientation === cfg.orientation
                ? prev
                : cfg,
            );
          } catch {}
        } else if (bytes[0] === 0x83) {
          const s = parseServerStreamStats(bytes.subarray(1));
          if (s) {
            serverStatsRef.current = s;
            const reconciled = reconcileStreamMode(
              pendingStreamModeRef.current,
              s.mode,
            );
            pendingStreamModeRef.current = reconciled.pending;
            setStreamMode(reconciled.mode);
          }
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current === currentWs) wsRef.current = null;
      currentWs?.close();
    };
  }, [config.wsUrl]);

  const sendWs = useCallback((tag: number, payload: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const msg = new Uint8Array(1 + json.length);
    msg[0] = tag;
    msg.set(json, 1);
    ws.send(msg);
  }, []);

  const onStreamTouch = useCallback((data: any) => sendWs(0x03, data), [sendWs]);
  const onStreamMultiTouch = useCallback((data: any) => sendWs(0x05, data), [sendWs]);
  const onStreamButton = useCallback((button: string) => sendWs(0x04, { button }), [sendWs]);
  const onStreamDigitalCrown = useCallback((delta: number) => sendWs(0x0a, { delta }), [sendWs]);
  const onStreamRequestKeyframe = useCallback(() => sendWs(0x0b, {}), [sendWs]);
  const onModeChange = useCallback(
    (mode: StreamMode) => {
      pendingStreamModeRef.current = { mode, mismatches: 0 };
      setStreamMode(mode);
      sendStreamMode(wsRef.current, mode);
    },
    [],
  );
  const onScreenConfigChange = useCallback((next: StreamConfig) => {
    setLiveStreamConfig((prev) =>
      prev &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.orientation === next.orientation
        ? prev
        : next,
    );
  }, []);
  const rotateDevice = useCallback((orientation: SimulatorOrientation) => {
    sendWs(0x07, { orientation });
  }, [sendWs]);
  const currentOrientation =
    (activeStreamConfig as { orientation?: SimulatorOrientation }).orientation ?? "portrait";
  const canRotate = deviceType !== "watch" && deviceType !== "vision";
  const rotateBy = useCallback(
    (direction: "left" | "right") => {
      if (!canRotate) return;
      const next = (direction === "left" ? ROTATE_LEFT_CYCLE : ROTATE_RIGHT_CYCLE)[currentOrientation];
      rotateDevice(next);
    },
    [canRotate, currentOrientation, rotateDevice],
  );

  // Flip the simulator between light and dark appearance. Reads the current
  // mode and sets the opposite, so every invocation is a real toggle — shared
  // by the toolbar button and the ⇧⌘A shortcut.
  const toggleAppearance = useCallback(() => {
    execOnHost(`xcrun simctl ui ${config.device} appearance`)
      .then((r) => {
        const next = r.stdout.trim() === "dark" ? "light" : "dark";
        return execOnHost(`xcrun simctl ui ${config.device} appearance ${next}`);
      })
      .catch(() => {});
  }, [config.device]);

  // Capture the simulator screen and download it immediately — shared by the
  // ⌘S shortcut. No preview or panel: the PNG lands straight in the browser's
  // downloads. Failures are non-fatal (the Screenshot card surfaces errors).
  const captureAndDownloadScreenshot = useCallback(async () => {
    try {
      const shot = await captureScreenshot(config.device);
      downloadScreenshot(shot, screenshotFilename(new Date()));
    } catch (e) {
      console.warn("Screenshot (⌘S) failed:", e);
    }
  }, [config.device]);

  useEffect(() => {
    setLiveStreamConfig(null);
    setWsStreamConfig(null);
  }, [config.streamUrl]);

  useEffect(() => {
    if (!streamConfig) return;
    setLiveStreamConfig((prev) =>
      prev &&
      prev.width === streamConfig.width &&
      prev.height === streamConfig.height &&
      prev.orientation === streamConfig.orientation
        ? prev
        : null,
    );
  }, [streamConfig, streamConfig?.width, streamConfig?.height, streamConfig?.orientation]);

  const sendKey = useCallback((type: "down" | "up", usage: number) => {
    sendWs(0x06, { type, usage });
  }, [sendWs]);

  // Subscribe to app-state SSE.
  const [detectedApp, setDetectedApp] = useState<DetectedAppState | null>(null);
  const currentApp = currentAppForDevice(detectedApp, config.device);
  const [statsOpen, setStatsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  useEffect(() => {
    pendingStreamModeRef.current = null;
    setStreamMode("perf");
  }, [config.device]);
  const { width: devtoolsPanelWidth, onPointerDown: onDevtoolsResize } = useResizableWidth(
    "headless-serve-sim:devtools-panel-width",
    DEVTOOLS_PANEL_WIDTH,
    420,
    1400,
  );
  const { width: gridPanelWidth, onPointerDown: onGridResize } = useResizableWidth(
    "headless-serve-sim:grid-panel-width",
    GRID_PANEL_WIDTH,
    360,
    1400,
  );
  const { width: connectionStatsPanelWidth, onPointerDown: onConnectionStatsResize } = useResizableWidth(
    "headless-serve-sim:connection-stats-width",
    CONNECTION_STATS_PANEL_WIDTH,
    280,
    560,
  );
  const { width: logsPanelWidth, onPointerDown: onLogsResize } = useResizableWidth(
    "headless-serve-sim:logs-panel-width",
    LOGS_PANEL_WIDTH,
    420,
    1400,
  );
  // SimulatorView emits Connection Stats here; the panel registers its sink so
  // only the panel re-renders on the 1 Hz cadence, not this whole tree.
  const serverStatsRef = useRef<ServerStreamStats | null>(null);
  useEffect(() => {
    serverStatsRef.current = null;
  }, [config.device, config.streamUrl]);
  const statsSinkRef = useRef<((snap: ConnectionStats) => void) | null>(null);
  const handleConnectionStats = useCallback((snap: ConnectionStats) => {
    // Merge server-pushed adaptive state (arrives on this WS, tag 0x83) into the
    // snapshot SimulatorView emits — in relay mode its own `server` is null.
    statsSinkRef.current?.({ ...snap, server: snap.server ?? serverStatsRef.current });
  }, []);
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 0),
  );
  const [viewportHeight, setViewportHeight] = useState(
    () => (typeof window !== "undefined" ? window.innerHeight : 0),
  );
  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    setDetectedApp(null);
    const es = new EventSource(config.appStateEndpoint ?? simEndpoint("appstate"));
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = (e) => {
      try {
        const next = JSON.parse(e.data) as { bundleId: string; pid?: number; isReactNative: boolean };
        if (timer) clearTimeout(timer);
        const delay = next?.isReactNative ? 0 : 600;
        timer = setTimeout(() => {
          setDetectedApp({ ...next, device: config.device });
        }, delay);
      } catch {}
    };
    return () => { if (timer) clearTimeout(timer); es.close(); };
  }, [config.appStateEndpoint, config.device]);

  // Cmd+R to reload the RN/Expo bundle.
  const sendReactNativeReload = useCallback(async () => {
    const META = 0xe3;
    const R = 0x15;
    sendKey("down", META);
    await new Promise((r) => setTimeout(r, 30));
    sendKey("down", R);
    await new Promise((r) => setTimeout(r, 30));
    sendKey("up", R);
    await new Promise((r) => setTimeout(r, 30));
    sendKey("up", META);
  }, [sendKey]);

  const simContainerRef = useRef<HTMLDivElement | null>(null);
  const recordingSourceRef = useRef<SimulatorRecordingSource | null>(null);
  const [simFocused, setSimFocused] = useState(true);
  const simFocusedRef = useRef(true);
  simFocusedRef.current = simFocused;
  const pressedKeysRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const inside = !!simContainerRef.current?.contains(e.target as Node);
      setSimFocused(inside);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    if (simFocused) return;
    const held = pressedKeysRef.current;
    if (held.size === 0) return;
    for (const usage of held) sendWs(0x06, { type: "up", usage });
    held.clear();
  }, [simFocused, sendWs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent, type: "down" | "up") => {
      // Appearance toggle (⇧⌘A) is a global UI command, not a keystroke
      // forwarded to the guest, so it must fire whenever the page is focused —
      // not only while the simulator canvas was the last thing clicked. Suppress
      // it only when the user is typing into a form field.
      if (e.code === "KeyA" && e.metaKey && e.shiftKey) {
        const target = e.target as HTMLElement | null;
        const typing =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!typing) {
          e.preventDefault();
          if (type === "down" && !e.repeat) toggleAppearance();
          return;
        }
      }
      // ⌘S captures + instantly downloads a screenshot. Like ⇧⌘A it's a global
      // UI command (fires whenever the page is focused, not only over the
      // canvas); intercepting it here also suppresses the browser's "Save Page".
      if (e.code === "KeyS" && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        const target = e.target as HTMLElement | null;
        const typing =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!typing) {
          e.preventDefault();
          if (type === "down" && !e.repeat) captureAndDownloadScreenshot();
          return;
        }
      }
      if (!simFocusedRef.current) return;
      if (e.code === "KeyH" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        if (type === "down" && !e.repeat) sendWs(0x04, { button: "home" });
        return;
      }
      if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        if (type === "down" && !e.repeat) {
          rotateBy(e.code === "ArrowLeft" ? "left" : "right");
        }
        return;
      }
      const usage = hidUsageForCode(e.code);
      if (usage == null) return;
      e.preventDefault();
      if (type === "down") pressedKeysRef.current.add(usage);
      else pressedKeysRef.current.delete(usage);
      sendWs(0x06, { type, usage });
    };
    const down = (e: KeyboardEvent) => onKey(e, "down");
    const up = (e: KeyboardEvent) => onKey(e, "up");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [sendWs, config.device, rotateBy, toggleAppearance, captureAndDownloadScreenshot]);

  const switchToDevice = useCallback(async (d: SimDevice) => {
    if (switching || d.udid === config.device) return;
    setSwitching(true);
    try {
      if (d.state !== "Booted") {
        await execOnHost(`xcrun simctl boot ${d.udid}`);
      }
      const detach = await execOnHost(`bunx headless-serve-sim --detach ${d.udid}`);
      if (detach.exitCode !== 0) throw new Error(detach.stderr || "Failed to start headless-serve-sim");
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("device", d.udid);
      window.location.assign(nextUrl.toString());
    } catch {
      setSwitching(false);
    }
  }, [switching, config.device, setSwitching]);

  const uploads = useUploadToasts();
  const mediaDrop = useMediaDrop({
    exec: execOnHost,
    udid: config.device,
    enabled: streaming,
    onUploadStart: uploads.add,
    onUploadProgress: uploads.setProgress,
    onUploadEnd: (id, ok, message) =>
      uploads.update(id, { status: ok ? "success" : "error", message }),
    onUnsupported: (file) => {
      const id = uploads.add(file.name, "media");
      uploads.update(id, {
        status: "error",
        message: `Unsupported: ${file.type || fileExtension(file)}`,
      });
    },
  });

  const stopDevice = useCallback(async (udid: string) => {
    setStoppingUdids((prev) => new Set(prev).add(udid));
    try {
      await execOnHost(`xcrun simctl shutdown ${udid}`);
      await fetchDevices();
    } finally {
      setStoppingUdids((prev) => {
        const next = new Set(prev);
        next.delete(udid);
        return next;
      });
    }
  }, [fetchDevices, setStoppingUdids]);

  // ── Layout geometry ──────────────────────────────────────────────────
  // Left column = top bar + device frame, filling the viewport height. The
  // frame fits within the space left of the inspector, preserving the device
  // aspect ratio; the top bar's width follows the frame width.
  // Both side rails — the left Activity gauges and the right inspector — share
  // the same collapsed/expanded geometry, default collapsed, and persist their
  // state across reloads.
  const [metricsOpen, setMetricsOpen] = usePersistedFlag("headless-serve-sim:metrics-open", false);
  const [inspectorOpen, setInspectorOpen] = usePersistedFlag("headless-serve-sim:inspector-open", false);
  const TOP_BAR_HEIGHT = 44;
  const RAIL_COLLAPSED_WIDTH = 44;
  const RAIL_EXPANDED_WIDTH = 360;
  const inspectorWidth = Math.min(
    inspectorOpen ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH,
    viewportWidth,
  );
  const metricsWidth = Math.min(
    metricsOpen ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH,
    viewportWidth,
  );
  // Both side rails are reserved out of the frame's available width, so the
  // device never slips under either bar at any viewport size.
  const sideRailsWidth = Math.min(metricsWidth + inspectorWidth, viewportWidth);

  // The assembly is wrapped in a 1px border on every outer edge; reserve those
  // 2px (top+bottom / left+right) so the bordered box always fits the viewport
  // and all four edges stay visible at any size.
  const ASSEMBLY_BORDER = 2;
  const frameGeom = useMemo(
    () =>
      fitDeviceFrame({
        viewportWidth,
        viewportHeight,
        topBarHeight: TOP_BAR_HEIGHT,
        sideRailsWidth,
        assemblyBorder: ASSEMBLY_BORDER,
        aspect: frameAspectRatioValue,
        maxWidth: frameMaxWidth,
        maxScale: SIMULATOR_RESIZE_MAX_SCALE,
      }),
    [viewportWidth, viewportHeight, sideRailsWidth, frameAspectRatioValue, frameMaxWidth],
  );

  return (
    <AxStateProvider endpoint={axOverlayEnabled ? config?.axEndpoint : undefined}>
    <div className="flex items-center justify-center h-screen w-screen overflow-hidden bg-page font-system">
      {/* The whole assembly enclosed by a real hairline border on ALL FOUR edges
          (the geometry reserves its 2px so it's never clipped, at any viewport
          size) — same border as the bars, no shadow. Internal seams come from
          the bars' own keylines. */}
      <div className="flex border border-divider">
      {/* Left rail — native foreground-app resource metrics. */}
      <MetricsBar
        open={metricsOpen}
        onToggle={() => setMetricsOpen((o) => !o)}
        collapsedWidth={RAIL_COLLAPSED_WIDTH}
        expandedWidth={RAIL_EXPANDED_WIDTH}
        topBarHeight={TOP_BAR_HEIGHT}
        frameHeight={frameGeom.height}
        metricsEndpoint={config.metricsEndpoint ?? simEndpoint("api/metrics")}
        enabled={streaming}
      />
      <div
        className="flex shrink-0 min-w-0 flex-col"
        style={{
          width: frameGeom.width,
          transition: "width 320ms cubic-bezier(0.4, 0, 0.6, 1)",
        }}
      >
        <SimulatorToolbar
          exec={execOnHost}
          onRotate={rotateDevice}
          orientation={(activeStreamConfig as { orientation?: SimulatorOrientation }).orientation ?? null}
          deviceUdid={config.device}
          deviceName={selectedDevice?.name ?? null}
          deviceRuntime={selectedDevice?.runtime ?? null}
          streaming={streaming}
        >
          <DevicePicker
            devices={devices}
            selectedUdid={config.device}
            loading={devicesLoading}
            error={devicesError}
            stoppingUdids={stoppingUdids}
            onRefresh={fetchDevices}
            onSelect={switchToDevice}
            onStop={stopDevice}
            trigger={<SimulatorToolbar.Title />}
          />
          <SimulatorToolbar.Actions>
            {currentApp?.isReactNative && (
              <SimulatorToolbar.Button
                aria-label="Reload React Native bundle"
                title="Reload (Cmd+R)"
                onClick={() => void sendReactNativeReload()}
              >
                <ReloadIcon />
              </SimulatorToolbar.Button>
            )}
            <SimulatorToolbar.HomeButton
              onClick={(e) => { e.preventDefault(); onStreamButton("home"); }}
            />
            <SimulatorToolbar.Button
              aria-label="Toggle light / dark appearance"
              title="Toggle light / dark (⇧⌘A)"
              onClick={() => toggleAppearance()}
            >
              <AppearanceIcon />
            </SimulatorToolbar.Button>
            <AxToolbarButton
              overlayEnabled={axOverlayEnabled}
              streaming={streaming}
              onToggleOverlay={() => setAxOverlayEnabled((enabled) => !enabled)}
            />
            <SimulatorToolbar.RotateButton title="Rotate device" />
          </SimulatorToolbar.Actions>
        </SimulatorToolbar>
        <div
          ref={simContainerRef}
          className="relative shrink-0 overflow-hidden bg-page"
          style={{ width: frameGeom.width, height: frameGeom.height }}
          {...mediaDrop.dropZoneProps}
        >
          <SimulatorView
            url={config.url}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            imageStyle={{ borderRadius: 0 } as CSSProperties}
            hideControls
            onStreamingChange={setStreaming}
            onStreamTouch={onStreamTouch}
            onStreamMultiTouch={onStreamMultiTouch}
            onStreamButton={onStreamButton}
            onStreamDigitalCrown={onStreamDigitalCrown}
            onStreamRequestKeyframe={onStreamRequestKeyframe}
            codec={useAvccVideo ? "avcc" : "mjpeg"}
            subscribeFrame={useAvccVideo ? undefined : mjpeg.subscribeFrame}
            streamFrame={useAvccVideo ? undefined : mjpeg.frame}
            streamConfig={activeStreamConfig}
            enableDigitalCrown={deviceType === "watch"}
            onScreenConfigChange={onScreenConfigChange}
            statsEnabled={statsOpen}
            onConnectionStats={handleConnectionStats}
            recordingSourceRef={recordingSourceRef}
          />
          {axOverlayEnabled && <AxDomOverlay />}
          {mediaDrop.isDragOver && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-accent bg-accent-tint backdrop-blur-[2px] text-accent pointer-events-none"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="text-[13px] font-medium">Drop media or .ipa</span>
            </div>
          )}
        </div>
      </div>

      {/* Upload toasts */}
      {uploads.toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-1.5 max-w-[320px] z-30">
          {uploads.toasts.map((t) => {
            const isError = t.status === "error";
            const isUploading = t.status === "uploading";
            // While transferring chunks, show "Uploading … N%". Once chunks
            // are done, the install/addmedia step has no progress signal, so
            // swap to a phase-specific verb and an indeterminate bar.
            const transferring = isUploading && t.progress !== null;
            const pct = t.progress != null ? Math.round(t.progress * 100) : 0;
            return (
              <div
                key={t.id}
                className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-card bg-panel border border-divider text-fg text-[12px] font-mono shadow-[0_4px_24px_rgba(0,0,0,0.12)] ${isError ? "select-text cursor-text" : "select-none cursor-default"}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-1.5 shrink-0 rounded-full [transition:background_0.3s]"
                    style={{ background: isUploading ? "var(--color-accent)" : t.status === "success" ? "var(--color-success)" : "var(--color-danger)" }}
                  />
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {isUploading && transferring &&
                      `Uploading ${t.name}… ${pct}%`}
                    {isUploading && !transferring &&
                      (t.kind === "ipa" ? `Installing ${t.name}…` : `Adding ${t.name}…`)}
                    {t.status === "success" &&
                      (t.kind === "ipa" ? `Installed ${t.name}` : `Added ${t.name} to Photos`)}
                    {isError && `${t.name}: ${t.message ?? "Upload failed"}`}
                  </span>
                </div>
                {isUploading && (
                  <div className="relative h-[3px] w-full rounded-full bg-hover overflow-hidden">
                    {transferring ? (
                      <div
                        className="h-full rounded-full bg-accent-solid [transition:width_120ms_linear]"
                        style={{ width: `${pct}%` }}
                      />
                    ) : (
                      <div className="headless-serve-sim-toast-indeterminate absolute top-0 left-0 h-full w-[40%] rounded-full bg-accent-solid" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Inspector */}
      <InspectorBar
        open={inspectorOpen}
        onToggle={() => setInspectorOpen((o) => !o)}
        collapsedWidth={RAIL_COLLAPSED_WIDTH}
        expandedWidth={RAIL_EXPANDED_WIDTH}
        topBarHeight={TOP_BAR_HEIGHT}
        frameHeight={frameGeom.height}
        openOverlay={statsOpen ? "stats" : logsOpen ? "logs" : gridOpen ? "grid" : devtoolsOpen ? "devtools" : null}
        udid={config.device}
        deviceFrameSpec={recordingDeviceFrameSpec}
        streaming={streaming}
        streamMode={streamMode}
        streamModeAvailable={useAvccVideo}
        onStreamModeChange={onModeChange}
        recordingSourceRef={recordingSourceRef}
        execToken={config.execToken}
        currentApp={currentApp}
        autoConnect={autoConnect}
        onAutoConnectChange={setAutoConnect}
        axOverlayEnabled={axOverlayEnabled}
        onToggleAxOverlay={() => setAxOverlayEnabled((enabled) => !enabled)}
        onOpenStats={() => {
          setLogsOpen(false);
          setGridOpen(false);
          setDevtoolsOpen(false);
          setStatsOpen(true);
        }}
        onOpenLogs={() => {
          setStatsOpen(false);
          setGridOpen(false);
          setDevtoolsOpen(false);
          setLogsOpen(true);
        }}
        onOpenGrid={() => {
          setStatsOpen(false);
          setLogsOpen(false);
          setDevtoolsOpen(false);
          setGridOpen(true);
        }}
        onOpenDevtools={() => {
          setStatsOpen(false);
          setLogsOpen(false);
          setGridOpen(false);
          setDevtoolsOpen(true);
        }}
      />
      </div>

      <GridPanel
        open={gridOpen}
        onClose={() => setGridOpen(false)}
        currentUdid={config.device}
        width={gridPanelWidth}
      />
      <ResizeHandle
        panelWidth={gridPanelWidth}
        visible={gridOpen}
        onPointerDown={onGridResize}
        ariaLabel="Resize simulators panel"
      />

      <WebKitDevtoolsPanel
        open={devtoolsOpen}
        onClose={() => setDevtoolsOpen(false)}
        udid={config.device}
        targets={devtools.targets}
        selectedTargetId={selectedDevtoolsTargetId}
        onSelectTarget={setSelectedDevtoolsTargetId}
        loading={devtools.loading}
        error={devtools.error}
        onRefresh={() => void devtools.refresh()}
        width={devtoolsPanelWidth}
      />
      <ResizeHandle
        panelWidth={devtoolsPanelWidth}
        visible={devtoolsOpen}
        onPointerDown={onDevtoolsResize}
        ariaLabel="Resize WebKit DevTools panel"
      />

      <ConnectionStatsPanel
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        width={connectionStatsPanelWidth}
        live={streaming}
        codecMode={useAvccVideo ? "avcc" : "mjpeg"}
        streamConfig={activeStreamConfig}
        sinkRef={statsSinkRef}
        mode={streamMode}
        onModeChange={onModeChange}
      />
      <ResizeHandle
        panelWidth={connectionStatsPanelWidth}
        visible={statsOpen}
        onPointerDown={onConnectionStatsResize}
        ariaLabel="Resize connection stats panel"
      />

      <LogsPanel
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        endpoint={config.logsEndpoint}
        appProcessId={currentApp?.pid ?? null}
        width={logsPanelWidth}
      />
      <ResizeHandle
        panelWidth={logsPanelWidth}
        visible={logsOpen}
        onPointerDown={onLogsResize}
        ariaLabel="Resize logs panel"
      />

    </div>
    </AxStateProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
