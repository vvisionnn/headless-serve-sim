import { createRoot } from "react-dom/client";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { animate, AnimatePresence, motion, useMotionValue, usePresence } from "motion/react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import {
  SimulatorView,
  displayStreamConfig,
  fallbackScreenSize,
  getDeviceType,
  matchDeviceFrameSpec,
  parseServerStreamStats,
  rotationDegreesForOrientation,
  simulatorMaxWidth,
  type DeviceType,
  type DeviceFrameSpec,
  type SimulatorOrientation,
  type StreamConfig,
  type ConnectionStats,
  type ServerStreamStats,
  type SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";

import { AxDomOverlay } from "./components/ax-dom-overlay";
import { AxStateProvider } from "./components/ax-state-provider";
import { BareScreen, DeviceBezel } from "./components/device-bezel";
import { NativeDuoDevice } from "./components/native-duo-device";
import { DeviceResizeHandles } from "./components/device-resize-handles";
import { PhonePreview } from "./components/phone-preview";
import { ConsolePanel } from "./console/console-panel";
import { Inspector } from "./inspector/inspector";
import type { InspectorProps } from "./inspector/types";
import { rubberband, spring } from "./lib/motion";
import { useTheme } from "./lib/theme";
import { DisconnectedScene } from "./scenes/disconnected-scene";
import { EmptyScene } from "./scenes/empty-scene";
import { WallScene } from "./scenes/wall-scene";
import { CommandPalette } from "./shell/command-palette";
import { DeviceDock } from "./shell/device-dock";
import { Navigator } from "./shell/navigator";
import { PhoneLinkButton } from "./shell/phone-link";
import {
  ShellContext,
  type Capture,
  type ConsoleTab,
  type InspectorTab,
  type Shell,
  type ShellToast,
} from "./shell/shell-context";
import {
  AppearanceReveal,
  DropOverlay,
  ScreenGlow,
  ScreenshotFlight,
  fittedRegion,
  largestSurface,
  screenCaptureAngle,
  Shutter,
  snapshotCanvas,
  snapshotScreen,
  useScreenColors,
  type Flight,
} from "./shell/stage-effects";
import { Toasts, type ToastItem } from "./shell/toasts";
import { Toolbar } from "./shell/toolbar";
import { TipProvider } from "./ui/tooltip";
import { useEventLogReporter } from "./hooks/use-event-log-reporter";
import { useMediaDrop } from "./hooks/use-media-drop";
import { useMjpegStream } from "./hooks/use-mjpeg-stream";
import { useAvccStream } from "./hooks/use-avcc-stream";
import { useScreenRecording } from "./hooks/use-screen-recording";
import { useUploadToasts, type UploadToast } from "./hooks/use-upload-toasts";
import { useWebKitDevtools } from "./hooks/use-webkit-devtools";
import { avccFallbackReducer, initialAvccFallback, AVCC_FRAME_TIMEOUT_MS } from "./avcc-fallback";
import { parseSimctlList, type SimDevice } from "./utils/devices";
import { fileExtension } from "./utils/drop";
import {
  execOnHost,
  hostDeviceMotionRequest,
  hostDeviceTouchRequest,
  hostSimulatorControlRequest,
} from "./utils/exec";
import { screenOrientationForDevice, withDeviceOrientation } from "./utils/device-orientation";
import { DeviceMotionTool, type DuoPose } from "./components/device-motion-tool";
import { createFoldControl } from "./utils/fold-control";
import { sendDeviceView, type DeviceView } from "./utils/device-view-control";
import { nativeTouchPoint } from "./utils/native-touch";
import { deviceConfig, keepDeviceConfigsWarm, switchWhileStarting } from "./utils/device-switch";
import { latestSwitch } from "./utils/latest-switch";
import { observedDuoOrientation, shouldApplyObservedHinge } from "./utils/fold-sync";
import { duoHardwareCommands } from "./utils/duo-hardware";
import { type HardwareButtonPress } from "./utils/hardware-buttons";
import {
  hidUsageForCode,
  reactNativeReloadKeys,
  releasePressedKeys,
  syncKeyboardModifiers,
} from "./utils/hid";
import {
  isSoftwareKeyboardShortcut,
  clipboardShortcut,
  isTextEntryTarget,
  isPreviewControlTarget,
} from "./utils/shortcuts";
import { rotateLeft } from "./utils/rotate";
import { cn } from "./lib/cn";
import { sameDuoBounds, type DuoBounds } from "./utils/duo-bounds";
import { resizeStart, rotationStart, type StagePose, type TurnOffsets } from "./utils/stage-pose";
import { confirmsOrientation } from "./utils/orientation-confirm";
import {
  flightStart,
  handOffStage,
  publishStageLayout,
  stageArrival,
  stageArrived,
  takeStageHandoff,
} from "./shell/stage-handoff";
import {
  b64ToBlob,
  captureScreenshot,
  downloadScreenshot,
  screenshotFilename,
} from "./utils/screenshot";
import { simEndpoint } from "./utils/sim-endpoint";
import { SIMULATOR_RESIZE_MAX_SCALE } from "./utils/simulator-resize";
import { toggleSimulatorAppearance } from "./utils/simulator-appearance";
import { cachedSimulatorSettings, patchSimulatorSettings } from "./utils/simulator-settings-cache";
import { fitDeviceFrame } from "./utils/frame-geometry";
import { fitDeviceBezel } from "./utils/bezel-geometry";
import { createCoalescedToast } from "./utils/coalesced-toast";
import { resolveActiveScreenConfig } from "./utils/screen-config";
import { readPersistedFlag, writePersistedFlag } from "./utils/persisted-flag";
import { paneInitiallyOpen } from "../preview-initial-state";
import { resolveEventsDevice } from "./utils/events-device";
import { previewConfigKey, selectedPreviewConfig } from "./utils/preview-config";
import {
  updateSelectedPreviewConnection,
  type PreviewConnectionState,
} from "./utils/preview-connection-state";
import { selectedSimulatorTarget } from "./utils/selected-simulator-connection";
import { selectedSimulatorReattachRequest } from "./utils/selected-simulator-reattach";
import {
  currentAppForDevice,
  goHomeAndSelectSpringBoard,
  type DetectedAppState,
} from "./utils/current-app";
import {
  reconcileStreamMode,
  sendStreamMode,
  type PendingStreamMode,
  type StreamMode,
} from "./utils/stream-mode-control";

// ─── App ───

// Boolean UI flag persisted to localStorage, so a rail's expanded/collapsed
// state survives a reload. Reads once on mount; writes on every change.
//
// `override` wins over the stored value for the initial render only — that's
// how `--panes` seeds the layout. It is deliberately one-shot: the user's own
// toggles after load still persist, so a launch flag configures the start
// state without permanently overriding the preference.
function usePersistedFlag(
  key: string,
  fallback: boolean,
  override?: boolean,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() =>
    override === undefined ? readPersistedFlag(key, fallback) : override,
  );
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
  const theme = useTheme();
  const [connection, setConnection] = useState<PreviewConnectionState<PreviewConfig>>(() => {
    const config = selectedPreviewConfig(window.__SIM_PREVIEW__);
    return { config, helperAvailable: config !== null };
  });
  const { config, helperAvailable } = connection;
  // The explicit selection. Reconnection stays pinned to it even while the
  // helper config is temporarily absent; an in-place switch moves it.
  const [urlDevice, setUrlDevice] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("device"),
  );
  const [streaming, setStreaming] = useState(false);
  // Each switch mounts a fresh shell, even for a device whose shell is still
  // fading out (Back mid-switch): revived, it would keep its old stream state.
  const [shellGeneration, setShellGeneration] = useState(0);
  const shellKey = `${config?.device}:${shellGeneration}`;
  // Only the selected shell may report streaming: the old one keeps painting
  // while it fades out and must not flip the new one live (nor dark, when
  // both show the same device).
  const selectedDeviceRef = useRef(config?.device);
  selectedDeviceRef.current = config?.device;
  const selectedShellRef = useRef(shellKey);
  selectedShellRef.current = shellKey;
  const setStreamingForSelected = useMemo(() => {
    return (value: boolean) => {
      if (selectedShellRef.current === shellKey) setStreaming(value);
    };
  }, [shellKey]);
  const [devices, setDevices] = useState<SimDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [stoppingUdids, setStoppingUdids] = useState<Set<string>>(new Set());
  const [switching, setSwitching] = useState(false);
  // The simulator a switch is leaving. Its device recedes at once, so the
  // click answers before the next one's config is in hand.
  const [departing, setDeparting] = useState<string | null>(null);
  const [axOverlayEnabled, setAxOverlayEnabled] = useState(false);
  const [selectedDevtoolsTargetId, setSelectedDevtoolsTargetId] = useState<string | null>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [lastDevice, setLastDevice] = useState<{ udid: string; name: string | null } | null>(() => {
    const p = selectedPreviewConfig(window.__SIM_PREVIEW__);
    return selectedSimulatorTarget({
      urlDevice: urlDevice,
      liveDevice: p?.device ?? null,
      liveDeviceName: p?.deviceName ?? null,
    });
  });
  // The last device's frame, so a disconnected simulator keeps its shape on
  // the stage while we wait for it to come back.
  const [lastFrameSpec, setLastFrameSpec] = useState<DeviceFrameSpec | null>(
    () => selectedPreviewConfig(window.__SIM_PREVIEW__)?.deviceFrameSpec ?? null,
  );
  const eventsDevice = resolveEventsDevice({
    urlDevice: urlDevice,
    initialDevice: lastDevice?.udid ?? null,
  });

  // `silent` refreshes a list already shown without flipping it to loading.
  const fetchDevices = useCallback(async (silent = false) => {
    if (!silent) {
      setDevicesLoading(true);
      setDevicesError(null);
    }
    try {
      const res = await execOnHost("xcrun simctl list devices available -j");
      if (res.exitCode !== 0) throw new Error(res.stderr || "simctl list failed");
      setDevices(parseSimctlList(res.stdout));
      setDevicesError(null);
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : "Failed to list devices");
    } finally {
      if (!silent) setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  // Refresh the device list whenever a new simulator is committed, so its name
  // is known (e.g. for the disconnected panel) even if it first appeared
  // out-of-band after load. Guarded on a live device: with no stream there's no
  // exec token to authenticate the list call. A switch keeps the list it has
  // on screen while that runs.
  const devicesListedRef = useRef(false);
  devicesListedRef.current = devices.length > 0;
  useEffect(() => {
    if (config?.device) void fetchDevices(devicesListedRef.current);
  }, [config?.device, fetchDevices]);

  useEffect(() => {
    // Pin the subscription to `eventsDevice` so the server streams only that
    // simulator (or null once it's gone) — never a different booted one.
    const eventsUrl = `${simEndpoint("api/events")}${eventsDevice ? `?device=${encodeURIComponent(eventsDevice)}` : ""}`;

    const applyConfig = (next: PreviewConfig | null) => {
      const selected = next?.device === eventsDevice ? next : null;
      if (selected) window.__SIM_PREVIEW__ = selected;
      setConnection((prev) => {
        const updated = updateSelectedPreviewConnection(prev, selected, eventsDevice);
        if (
          updated.helperAvailable === prev.helperAvailable &&
          previewConfigKey(updated.config) === previewConfigKey(prev.config)
        ) {
          return prev;
        }
        return updated;
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
    if (config.deviceFrameSpec) setLastFrameSpec(config.deviceFrameSpec);
    setShowPicker(false);
  }, [config]);

  useEffect(() => {
    if (!helperAvailable) setStreaming(false);
  }, [helperAvailable]);

  // Switch simulators in place: fetch the target's config first (a hover may
  // already have), then swap it in one render, so the window never blanks the
  // way a page load does. The new shell settles in while its stream connects.
  // Back during a click's switch starts another; only the latest one lands.
  const [runSwitch] = useState(latestSwitch<PreviewConfig>);
  const switchDevice = useCallback(
    async (udid: string, push = true) => {
      await runSwitch(
        () => deviceConfig(udid),
        (next) => {
          window.__SIM_PREVIEW__ = next;
          if (push) {
            const location = new URL(window.location.href);
            location.searchParams.set("device", udid);
            window.history.pushState(null, "", location);
          }
          // The new shell mounts in slices, so what's already moving keeps moving.
          startTransition(() => {
            setStreaming(false);
            setShellGeneration((n) => n + 1);
            setUrlDevice(udid);
            setConnection({ config: next, helperAvailable: true });
            setSwitching(false);
            setDeparting(null);
          });
        },
      );
    },
    [runSwitch],
  );
  // Back and forward walk the same in-place switches.
  useEffect(() => {
    const onPop = () => {
      const udid = new URLSearchParams(window.location.search).get("device");
      if (!udid) return;
      handOffStage();
      setDeparting(selectedDeviceRef.current ?? null);
      void switchDevice(udid, false).catch(() => window.location.reload());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [switchDevice]);

  useEffect(() => {
    const request = selectedSimulatorReattachRequest(helperAvailable, eventsDevice);
    if (!request) return;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const attach = async () => {
      try {
        await fetch(simEndpoint("grid/api/attach"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
      } catch {}
      if (!cancelled) retry = setTimeout(attach, 1_000);
    };
    void attach();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [eventsDevice, helperAvailable]);

  if (!config) {
    // A device we were streaming just went away: wait for the SAME simulator.
    // The manual "choose another" escape falls through to the boot picker.
    if (lastDevice && !showPicker) {
      // The SSE-pushed config omits deviceName, so prefer the live device list
      // (which knows the name of any booted/shutdown sim) and fall back to the
      // name captured when we last had a config.
      const name = devices.find((d) => d.udid === lastDevice.udid)?.name ?? lastDevice.name;
      return (
        <DisconnectedScene
          deviceName={name}
          frameSpec={lastFrameSpec}
          onChooseAnother={() => setShowPicker(true)}
        />
      );
    }
    return (
      <EmptyScene
        devices={devices}
        loading={devicesLoading}
        error={devicesError}
        onRefresh={() => void fetchDevices()}
      />
    );
  }

  return (
    <AnimatePresence initial={false}>
      <ShellLayer key={shellKey}>
        <AppWithConfig
          config={config}
          theme={theme}
          devices={devices}
          devicesLoading={devicesLoading}
          devicesError={devicesError}
          stoppingUdids={stoppingUdids}
          setStoppingUdids={setStoppingUdids}
          switching={switching}
          setSwitching={setSwitching}
          departing={departing === config.device}
          setDeparting={setDeparting}
          axOverlayEnabled={axOverlayEnabled}
          setAxOverlayEnabled={setAxOverlayEnabled}
          selectedDevtoolsTargetId={selectedDevtoolsTargetId}
          setSelectedDevtoolsTargetId={setSelectedDevtoolsTargetId}
          streaming={streaming}
          setStreaming={setStreamingForSelected}
          fetchDevices={fetchDevices}
          onSwitchDevice={switchDevice}
        />
      </ShellLayer>
    </AnimatePresence>
  );
}

/**
 * One shell per simulator. On a switch the new one mounts in place underneath
 * and the old one fades out over it once the new device is on the stage, so
 * only what differs — the device, the wall closing — appears to move.
 */
function ShellLayer({ children }: { children: React.ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (present) return;
    let stopped = false;
    let fade: ReturnType<typeof animate> | null = null;
    const leave = () => {
      if (stopped) return;
      if (!ref.current) return safeToRemove?.();
      fade = animate(ref.current, { opacity: 0 }, { duration: 0.22, ease: [0.32, 0.72, 0, 1] });
      void fade.then(() => safeToRemove?.());
    };
    const arrival = stageArrival();
    if (!arrival) leave();
    else {
      // Never longer than this: a Duo whose first composite is slow.
      const cap = setTimeout(leave, 800);
      void arrival.then(() => {
        clearTimeout(cap);
        leave();
      });
    }
    return () => {
      stopped = true;
      fade?.stop();
    };
  }, [present, safeToRemove]);
  return (
    <div
      ref={ref}
      className="fixed inset-0"
      style={present ? undefined : { zIndex: 1, pointerEvents: "none" }}
    >
      {children}
    </div>
  );
}

interface AppWithConfigProps {
  config: PreviewConfig;
  theme: Shell["theme"];
  devices: SimDevice[];
  devicesLoading: boolean;
  devicesError: string | null;
  stoppingUdids: Set<string>;
  setStoppingUdids: React.Dispatch<React.SetStateAction<Set<string>>>;
  switching: boolean;
  setSwitching: (v: boolean) => void;
  /** A switch is leaving this simulator. */
  departing: boolean;
  setDeparting: (udid: string | null) => void;
  axOverlayEnabled: boolean;
  setAxOverlayEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDevtoolsTargetId: string | null;
  setSelectedDevtoolsTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  streaming: boolean;
  setStreaming: (v: boolean) => void;
  fetchDevices: () => Promise<void>;
  /** Swap the window to another simulator without reloading the page. */
  onSwitchDevice: (udid: string) => Promise<void>;
}

// Floating-panel geometry — the same numbers as the approved design.
const NAV_W = 264;
const INS_W = 328;
const GAP = 10;
const TOOLBAR_H = 52;
const DOCK_SPACE = 84;
const FOLD_SPACE = 58;
const CONSOLE_MIN = 180;
let toastSeq = 0;
let captureSeq = 0;

function AppWithConfig({
  config,
  theme,
  devices,
  devicesLoading,
  devicesError,
  stoppingUdids,
  setStoppingUdids,
  switching,
  setSwitching,
  departing,
  setDeparting,
  axOverlayEnabled,
  setAxOverlayEnabled,
  selectedDevtoolsTargetId,
  setSelectedDevtoolsTargetId,
  streaming,
  setStreaming,
  fetchDevices,
  onSwitchDevice,
}: AppWithConfigProps) {
  // A device switch hands over the window's layout and where the device was,
  // so the shell stays still and plays no entrance; a page load plays it.
  const [handoff] = useState(takeStageHandoff);
  const intro = handoff === null;
  // The navigator's search and scroll seed only the navigator this shell
  // opens with; one opened later starts fresh.
  const navigatorSeed = useRef(handoff?.layout.navigator);
  useEffect(() => {
    navigatorSeed.current = undefined;
  }, []);
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

  // ── Shell state ──────────────────────────────────────────────────────
  // `--panes` seeds the first render; afterwards the user's toggles persist.
  const launchState = window.__SIM_PREVIEW__?.initialState;
  const launchPanes = launchState?.panes;
  const [navigatorOpen, setNavigatorOpen] = usePersistedFlag(
    "headless-serve-sim:navigator-open",
    false,
    handoff
      ? handoff.layout.navigatorOpen
      : launchPanes
        ? launchPanes.includes("devices")
        : undefined,
  );
  const [inspectorOpen, setInspectorOpen] = usePersistedFlag(
    "headless-serve-sim:inspector-open",
    true,
    handoff
      ? handoff.layout.inspectorOpen
      : launchPanes
        ? launchPanes.includes("inspector") || launchPanes.includes("metrics")
        : undefined,
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(
    () =>
      handoff?.layout.inspectorTab ??
      (paneInitiallyOpen(launchState, "metrics", false) &&
      !paneInitiallyOpen(launchState, "inspector", false)
        ? "activity"
        : "device"),
  );
  const [consoleOpen, setConsoleOpen] = useState(
    () =>
      handoff?.layout.consoleOpen ??
      (paneInitiallyOpen(launchState, "logs", false) ||
        paneInitiallyOpen(launchState, "devtools", false)),
  );
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>(
    () =>
      handoff?.layout.consoleTab ??
      (paneInitiallyOpen(launchState, "devtools", false) &&
      !paneInitiallyOpen(launchState, "logs", false)
        ? "web"
        : "logs"),
  );
  const [consoleHeight, setConsoleHeight] = useState(handoff?.layout.consoleHeight ?? 300);
  const [wallOpen, setWallOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const devtoolsOpen = consoleOpen && consoleTab === "web";

  const [toasts, setToasts] = useState<ShellToast[]>([]);
  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  const settleToast = useCallback(
    (t: Pick<ShellToast, "id" | "tone" | "progress">) => {
      // Finished toasts leave on their own; running ones wait for an update.
      if (t.progress == null && (t.tone === "success" || t.tone === "danger"))
        setTimeout(() => dismissToast(t.id), t.tone === "danger" ? 6000 : 3500);
    },
    [dismissToast],
  );
  const toast = useCallback(
    (t: Omit<ShellToast, "id">) => {
      const id = ++toastSeq;
      setToasts((list) => [...list, { ...t, id }]);
      settleToast({ ...t, id });
      return id;
    },
    [settleToast],
  );
  const updateToast = useCallback(
    (id: number, patch: Partial<ShellToast>) => {
      setToasts((list) => {
        const next = list.map((t) => (t.id === id ? { ...t, ...patch } : t));
        const t = next.find((x) => x.id === id);
        if (t) settleToast(t);
        return next;
      });
    },
    [settleToast],
  );

  const [captures, setCaptures] = useState<Capture[]>([]);
  const addCapture = useCallback((c: Omit<Capture, "id">) => {
    setCaptures((list) => [{ ...c, id: ++captureSeq }, ...list].slice(0, 24));
  }, []);
  const [shutter, setShutter] = useState(0);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [reveal, setReveal] = useState<{
    id: number;
    url: string;
    source: CanvasImageSource | null;
  } | null>(null);
  const endReveal = useCallback(() => setReveal(null), []);
  const endFlight = useCallback(() => setFlight(null), []);

  const foldable =
    config.deviceTypeIdentifier === "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo";
  const [hingeAngle, setHingeAngle] = useState(180);
  // The fold bar waits for the real angle rather than flashing the default.
  const [hingeKnown, setHingeKnown] = useState(false);
  const [foldError, setFoldError] = useState<string | null>(null);
  const [showBezels, setShowBezels] = useState(config.screenConfig?.includeFrame ?? true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const deviceViewRef = useRef<DeviceView | null>(null);
  const [duoOrientation, setDuoOrientation] = useState<SimulatorOrientation | null>(null);
  const [deviceScale, setDeviceScale] = useState(1);
  const duoResizeRef = useRef<HTMLDivElement | null>(null);
  const [duoBounds, setDuoBounds] = useState<DuoBounds | null>(null);
  const updateDuoBounds = useCallback((bounds: DuoBounds) => {
    const element = duoResizeRef.current;
    if (element) {
      element.style.left = `${bounds.x}px`;
      element.style.top = `${bounds.y}px`;
      element.style.width = `${bounds.width}px`;
      element.style.height = `${bounds.height}px`;
    }
    // The dock and fold bar sit under the visible device, so any move or
    // resize matters — not only a change of the fitted size.
    setDuoBounds((previous) => (previous && sameDuoBounds(previous, bounds) ? previous : bounds));
  }, []);
  const [slowAnimations, setSlowAnimations] = useState(false);
  const [keyboardCapture, setKeyboardCapture] = useState(false);
  const hingeEditRef = useRef(0);
  const hingePendingRef = useRef(false);
  const orientationEditRef = useRef(0);
  const orientationPendingRef = useRef(false);
  const foldControl = useMemo(
    () =>
      createFoldControl(async (angle) => {
        await hostDeviceMotionRequest({ device: config.device, command: "angle", angle });
      }),
    [config.device],
  );
  const changeHingeAngle = useCallback(
    (angle: number) => {
      const edit = ++hingeEditRef.current;
      hingePendingRef.current = true;
      setHingeAngle(angle);
      setHingeKnown(true);
      setFoldError(null);
      void foldControl
        .set(angle)
        .catch((error: unknown) => {
          if (edit === hingeEditRef.current)
            setFoldError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (edit === hingeEditRef.current) hingePendingRef.current = false;
        });
    },
    [foldControl],
  );
  const duoPose: DuoPose = hingeAngle === 0 ? "closed" : hingeAngle === 180 ? "open" : "book";
  useEffect(() => {
    if (!foldable) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const edit = hingeEditRef.current;
      const orientationEdit = orientationEditRef.current;
      try {
        const state = await hostDeviceMotionRequest({ device: config.device, command: "state" });
        const orientation = observedDuoOrientation(
          state?.observed.orientation,
          orientationEdit,
          orientationEditRef.current,
          orientationPendingRef.current,
          state?.commanded.orientation,
        );
        if (!stopped && orientation) setDuoOrientation(orientation);
        const observed = state?.observed.hingeAngle;
        if (
          !stopped &&
          shouldApplyObservedHinge({
            requestedRevision: edit,
            currentRevision: hingeEditRef.current,
            pending: hingePendingRef.current,
            animating: false,
            angle: observed,
          })
        )
          setHingeAngle(observed!);
      } catch (error) {
        if (!stopped) setFoldError(error instanceof Error ? error.message : String(error));
      }
      if (!stopped) setHingeKnown(true);
      if (!stopped) timer = setTimeout(read, 2000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [foldable, config.device]);

  const deviceType: DeviceType =
    config.deviceFrameSpec?.family ??
    getDeviceType(
      selectedDevice?.deviceTypeIdentifier ?? config.deviceTypeIdentifier ?? resolvedDeviceName,
    );
  const devtools = useWebKitDevtools(
    config.devtoolsEndpoint ?? simEndpoint("devtools"),
    devtoolsOpen,
  );

  useEffect(() => {
    if (!devtoolsOpen) return;
    if (
      selectedDevtoolsTargetId &&
      devtools.targets.some((target) => target.id === selectedDevtoolsTargetId)
    )
      return;
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
  // `/stream.avcc` at all. A device started from an older installed CLI may
  // predate H.264 and 404 the endpoint (cross-origin that 404 is opaque to
  // fetch, so "no frame arrived" is the only reliable signal).
  // `avccFallback` drives a startup timeout: if AVCC paints nothing in time,
  // drop to MJPEG, which every helper serves. See avcc-fallback.ts.
  const avcc = useAvccStream();
  const [avccFallback, dispatchAvccFallback] = useReducer(avccFallbackReducer, initialAvccFallback);
  // A server-pinned "mjpeg" codec wins over browser capability: the host may
  // be unable to *encode* H.264 even where the browser could decode it.
  const useAvccVideo = avcc.supported && !avccFallback.fellBack && config.codec !== "mjpeg";
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
    const timer = setTimeout(() => dispatchAvccFallback("timeout"), AVCC_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [useAvccVideo, config.streamUrl]);
  // The stream layer already recovers from a decoder fault by recreating the
  // decoder and reconnecting, so one error is not a reason to downgrade. A run
  // of them with no frame in between means recovery isn't working — then the
  // reducer drops us to MJPEG rather than looping on H.264.
  const onDecoderError = useCallback(() => dispatchAvccFallback("error"), []);
  // A decoded frame after a fault ends the run — `streaming` alone can't do this
  // job: it only flips on the view's staleness watchdog, which a fast recovery
  // never trips, so transient errors would otherwise accumulate forever.
  const onDecoderRecover = useCallback(() => dispatchAvccFallback("frame"), []);
  const [liveStreamConfig, setLiveStreamConfig] = useState<StreamConfig | null>(null);
  // Screen config now arrives over the input WebSocket (pushed by the helper on
  // connect + on every dimension/orientation change) instead of a 1s /config poll.
  const [wsStreamConfig, setWsStreamConfig] = useState<StreamConfig | null>(null);
  const streamConfig = wsStreamConfig;
  // How the device is held. The helper reports the foreground app's interface
  // orientation, which stays portrait in a portrait-only app (the home screen)
  // even with the device sideways; Simulator.app turns the device regardless,
  // so the stage follows this instead. Set at once when we turn it, confirmed
  // from devicectl whenever the app's orientation moves.
  const [deviceOrientation, setDeviceOrientation] = useState<SimulatorOrientation | null>(null);
  const activeStreamConfig = withDeviceOrientation(
    resolveActiveScreenConfig({
      live: liveStreamConfig,
      ws: streamConfig,
      injected: config.screenConfig,
      fallback:
        config.deviceFrameSpec?.nativeScreen ?? fallbackScreenSize(deviceType, resolvedDeviceName),
    }),
    foldable ? null : deviceOrientation,
  );
  // The helper's capability decides. Until a foldable's helper has said either
  // way, expect its composite rather than drawing a stand-in phone that the
  // real device would then replace.
  const nativeComposition =
    foldable &&
    (activeStreamConfig.deviceComposition === true ||
      (activeStreamConfig.deviceComposition === undefined && !streaming));
  const deviceFrameSpecs =
    config.deviceFrameSpecs ?? (config.deviceFrameSpec ? [config.deviceFrameSpec] : []);
  const selectedFrameSpec =
    deviceFrameSpecs.length > 0
      ? matchDeviceFrameSpec(
          {
            deviceTypeIdentifier: config.deviceTypeIdentifier,
            modelName: config.deviceFrameSpec?.modelName,
            family: deviceType === "vision" ? null : deviceType,
          },
          activeStreamConfig,
          deviceFrameSpecs,
        ).spec
      : null;
  const recordingDeviceFrameSpec: DeviceFrameSpec | DeviceType | null = config.deviceFrameSpec
    ? (matchDeviceFrameSpec(
        {
          deviceTypeIdentifier: selectedDevice?.deviceTypeIdentifier ?? config.deviceTypeIdentifier,
          modelName: config.deviceFrameSpec.modelName,
          family: deviceType === "vision" ? null : deviceType,
        },
        activeStreamConfig,
        deviceFrameSpecs,
      ).spec ?? (deviceType === "vision" ? null : deviceType))
    : deviceType === "vision"
      ? null
      : deviceType;
  const frameMaxWidth = simulatorMaxWidth(deviceType, activeStreamConfig);
  const frameDisplayConfig = displayStreamConfig(activeStreamConfig);
  const frameAspectRatioValue = frameDisplayConfig
    ? frameDisplayConfig.width / frameDisplayConfig.height
    : 1;

  // Touch/button relay via direct WebSocket
  const [streamMode, setStreamMode] = useState<StreamMode>(foldable ? "quality" : "perf");
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
        sendDeviceView(ws, deviceViewRef.current);
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
            if (
              cfg.deviceComposition &&
              cfg.includeFrame !== undefined &&
              deviceViewRef.current?.includeFrame === undefined
            )
              setShowBezels(cfg.includeFrame);
            setWsStreamConfig((prev) =>
              prev &&
              prev.width === cfg.width &&
              prev.height === cfg.height &&
              prev.orientation === cfg.orientation &&
              prev.displayId === cfg.displayId &&
              prev.deviceComposition === cfg.deviceComposition &&
              prev.includeFrame === cfg.includeFrame
                ? prev
                : cfg,
            );
          } catch {}
        } else if (bytes[0] === 0x83) {
          const s = parseServerStreamStats(bytes.subarray(1));
          if (s) {
            serverStatsRef.current = s;
            const reconciled = reconcileStreamMode(pendingStreamModeRef.current, s.mode);
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

  // Input goes browser → helper directly, so the server can't observe it; the
  // page reports what it sends. Batched — at frame rate a request per event
  // would be a burst of traffic just to record history.
  const logEvent = useEventLogReporter(config.execToken, config.device);

  // A drag is one gesture, not hundreds of events: collapse the moves and log
  // the whole thing once on release. Logging every move would bury every other
  // event in the window and make the panel useless during a scroll.
  const dragRef = useRef<{ x: number; y: number; moves: number } | null>(null);

  // A failed input event is worth a word, not the stream's error screen, which
  // nothing clears while the stream itself is fine. One word: a failing drag
  // fails every move, and those update one toast rather than stacking.
  const inputErrorToast = useMemo(
    () =>
      createCoalescedToast({
        holdMs: 6000,
        nextId: () => ++toastSeq,
        show: (id, detail) =>
          setToasts((list) =>
            list.some((t) => t.id === id)
              ? list.map((t) => (t.id === id ? { ...t, detail } : t))
              : [...list, { id, title: "Input not delivered", detail, tone: "danger" }],
          ),
        dismiss: dismissToast,
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (timer) => clearTimeout(timer),
      }),
    [dismissToast],
  );
  const reportInputError = useCallback(
    (error: unknown) => inputErrorToast(error instanceof Error ? error.message : String(error)),
    [inputErrorToast],
  );
  const keyboardQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const queueKeyboard = useCallback(
    (operation: () => Promise<unknown>) => {
      keyboardQueueRef.current = keyboardQueueRef.current.then(operation).catch(reportInputError);
    },
    [reportInputError],
  );
  const onStreamTouch = useCallback(
    (data: any) => {
      if (deviceType === "ipad") {
        queueKeyboard(async () => {
          const handled = await hostDeviceTouchRequest({
            device: config.device,
            ...nativeTouchPoint(data),
            phase: data.type,
          });
          if (!handled) sendWs(0x03, data);
        });
      } else sendWs(0x03, data);
      if (data?.type === "begin") {
        dragRef.current = { x: data.x, y: data.y, moves: 0 };
      } else if (data?.type === "move") {
        if (dragRef.current) dragRef.current.moves++;
      } else if (data?.type === "end") {
        const start = dragRef.current;
        dragRef.current = null;
        if (!start || start.moves === 0) {
          logEvent({ kind: "tap", details: { x: data?.x, y: data?.y } });
          return;
        }
        const distance = Math.hypot((data?.x ?? start.x) - start.x, (data?.y ?? start.y) - start.y);
        logEvent({
          kind: "drag",
          details: {
            fromX: start.x,
            fromY: start.y,
            toX: data?.x,
            toY: data?.y,
            distance,
            moves: start.moves,
          },
        });
      }
    },
    [deviceType, config.device, queueKeyboard, sendWs, logEvent],
  );
  const onStreamMultiTouch = useCallback(
    (data: any) => {
      sendWs(0x05, data);
      if (data?.type === "begin") {
        logEvent({
          kind: "multi-touch",
          details: { x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2 },
        });
      }
    },
    [sendWs, logEvent],
  );
  const sendHardwareButton = useCallback(
    (press: HardwareButtonPress) => {
      const commands = foldable ? duoHardwareCommands(press) : null;
      if (!commands) {
        sendWs(0x04, press);
        return;
      }
      void (async () => {
        for (const [index, command] of commands.entries()) {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, 150));
          await hostDeviceMotionRequest({ device: config.device, command: "consumer", ...command });
        }
      })().catch((error: unknown) =>
        setFoldError(error instanceof Error ? error.message : String(error)),
      );
    },
    [foldable, config.device, sendWs],
  );
  const onStreamButton = useCallback(
    (button: string) => {
      sendHardwareButton({ button });
      logEvent({ kind: "button", details: { button } });
    },
    [sendHardwareButton, logEvent],
  );
  const onStreamDigitalCrown = useCallback((delta: number) => sendWs(0x0a, { delta }), [sendWs]);
  const onStreamRequestKeyframe = useCallback(() => sendWs(0x0b, {}), [sendWs]);
  const onStreamScroll = useCallback(
    (data: { dx: number; dy: number; x: number; y: number }) => sendWs(0x0d, data),
    [sendWs],
  );
  const toggleSoftwareKeyboard = useCallback(() => {
    void hostDeviceMotionRequest({ device: config.device, command: "software-keyboard" }).catch(
      reportInputError,
    );
    logEvent({ kind: "software-keyboard" });
  }, [config.device, logEvent, reportInputError]);
  const onModeChange = useCallback((mode: StreamMode) => {
    pendingStreamModeRef.current = { mode, mismatches: 0 };
    setStreamMode(mode);
    sendStreamMode(wsRef.current, mode);
  }, []);
  const onScreenConfigChange = useCallback((next: StreamConfig) => {
    setLiveStreamConfig((prev) =>
      prev &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.orientation === next.orientation &&
      prev.interfaceOrientation === next.interfaceOrientation &&
      prev.displayId === next.displayId &&
      prev.deviceComposition === next.deviceComposition
        ? prev
        : next,
    );
  }, []);
  // Set when someone asks for a turn, so only that turn animates — not a
  // landscape stream arriving on load.
  const rotateRequestedAt = useRef(0);
  // Only turns we command ourselves, not ones we read back.
  const turnCommandedAt = useRef(0);
  // Set by one-step resizes (the bezel, zoom to fit), so those animate while
  // drags and window resizes track the pointer directly.
  const resizeRequestedAt = useRef(0);
  const deviceOrientationEdit = useRef(0);
  const rotateDevice = useCallback(
    (orientation: SimulatorOrientation) => {
      rotateRequestedAt.current = turnCommandedAt.current = Date.now();
      if (!foldable) {
        deviceOrientationEdit.current++;
        setDeviceOrientation(orientation);
      }
      if (foldable) {
        const physical = {
          portrait: "portrait",
          portrait_upside_down: "portraitUpsideDown",
          landscape_left: "landscapeRight",
          landscape_right: "landscapeLeft",
        }[orientation];
        const edit = ++orientationEditRef.current;
        orientationPendingRef.current = true;
        setDuoOrientation(orientation);
        void hostDeviceMotionRequest({
          device: config.device,
          command: "orientation",
          orientation: physical,
        })
          .catch((error: unknown) => {
            if (edit === orientationEditRef.current)
              setFoldError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            if (edit === orientationEditRef.current) orientationPendingRef.current = false;
          });
      } else sendWs(0x07, { orientation });
    },
    [sendWs, foldable, config.device],
  );
  // Confirm how the device is held: on connect, and whenever the app's own
  // orientation moves (something turned it). A read that raced one of our own
  // turns is dropped rather than snapping the stage back, and the app turning
  // with one we just made isn't read at all.
  const reportedOrientation = (streamConfig as { orientation?: SimulatorOrientation } | null)
    ?.orientation;
  const deviceOrientationKnown = useRef(false);
  useEffect(() => {
    if (foldable || !streaming) return;
    if (!confirmsOrientation(Date.now(), turnCommandedAt.current)) return;
    let stopped = false;
    const edit = deviceOrientationEdit.current;
    const timer = setTimeout(() => {
      void hostSimulatorControlRequest({ device: config.device })
        .then((state) => {
          const next = screenOrientationForDevice(state.orientation);
          if (stopped || !next || edit !== deviceOrientationEdit.current) return;
          // A turn we didn't make still turns the stage, once we know where it was.
          if (deviceOrientationKnown.current) rotateRequestedAt.current = Date.now();
          deviceOrientationKnown.current = true;
          setDeviceOrientation(next);
        })
        .catch(() => {});
    }, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [foldable, streaming, config.device, reportedOrientation]);
  useEffect(() => {
    if (!nativeComposition) {
      deviceViewRef.current = null;
      return;
    }
    if (!duoOrientation) return;
    deviceViewRef.current = {
      ...deviceViewRef.current,
      rotation: rotationDegreesForOrientation(duoOrientation),
    };
    if (streaming) sendDeviceView(wsRef.current, deviceViewRef.current);
  }, [nativeComposition, streaming, duoOrientation]);
  const changeBezels = useCallback(
    (includeFrame: boolean) => {
      resizeRequestedAt.current = Date.now();
      setShowBezels(includeFrame);
      if (!nativeComposition) return;
      deviceViewRef.current = {
        ...deviceViewRef.current,
        rotation: rotationDegreesForOrientation(duoOrientation ?? "portrait"),
        includeFrame,
      };
      sendDeviceView(wsRef.current, deviceViewRef.current);
    },
    [nativeComposition, duoOrientation],
  );
  const changeOutputSide = useCallback((outputSize: number) => {
    if (deviceViewRef.current?.outputSize === outputSize) return;
    deviceViewRef.current = { ...deviceViewRef.current, outputSize };
    sendDeviceView(wsRef.current, deviceViewRef.current);
  }, []);
  const currentOrientation = foldable
    ? (duoOrientation ?? "portrait")
    : ((activeStreamConfig as { orientation?: SimulatorOrientation }).orientation ?? "portrait");
  // Flip the simulator between light and dark appearance, so every invocation
  // is a real toggle — shared by the toolbar button and the ⇧⌘A shortcut. The
  // last known mode (the inspector's cache) saves reading it first, and the
  // inspector's pill moves at the click rather than after simctl returns.
  const toggleAppearance = useCallback(() => {
    // Hold the current frame so the new appearance can be revealed under it.
    const snap = snapshotScreen(simContainerRef.current);
    if (snap) {
      const source = largestSurface(simContainerRef.current);
      setReveal({ id: Date.now(), url: snap.url, source });
    }
    const udid = config.device;
    const known = cachedSimulatorSettings(udid)?.appearance;
    if (known) patchSimulatorSettings(udid, { appearance: known === "dark" ? "light" : "dark" });
    void toggleSimulatorAppearance(udid, execOnHost, refreshUiSettings, known).catch(
      refreshUiSettings,
    );
  }, [config.device]);

  // Screenshot: flash, capture, then the thumbnail lifts off the screen into
  // the corner and the file lands in Recent captures. ⌘S has always meant
  // "download now", so the PNG still downloads straight away too.
  const captureAndDownloadScreenshot = useCallback(async () => {
    setShutter((n) => n + 1);
    // The thumbnail lifts off at once, from the frame on screen; the real
    // PNG from simctl lands in Recent when it's ready.
    const snap = snapshotScreen(simContainerRef.current);
    if (snap) setFlight({ id: Date.now(), from: snap.rect, url: snap.url });
    const from = snap ? null : (simContainerRef.current?.getBoundingClientRect() ?? null);
    try {
      const shot = await captureScreenshot(config.device, {
        display: activeStreamConfig.displayId ? `${activeStreamConfig.displayId}` : "",
      });
      const filename = screenshotFilename(new Date());
      const blob = b64ToBlob(shot.bytesB64, "image/png");
      const url = URL.createObjectURL(blob);
      const size = await pngSize(blob);
      addCapture({
        kind: "screenshot",
        createdAt: Date.now(),
        meta: size ? `${size.width} × ${size.height} · PNG` : "PNG",
        url,
        filename,
        blob,
      });
      if (from) setFlight({ id: Date.now(), from, url });
      downloadScreenshot(shot, filename);
    } catch (e) {
      toast({
        title: "Screenshot failed",
        detail: e instanceof Error ? e.message : String(e),
        tone: "danger",
      });
    }
  }, [config.device, activeStreamConfig.displayId, addCapture, toast]);

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
      prev.orientation === streamConfig.orientation &&
      prev.displayId === streamConfig.displayId
        ? prev
        : null,
    );
  }, [
    streamConfig,
    streamConfig?.width,
    streamConfig?.height,
    streamConfig?.orientation,
    streamConfig?.displayId,
  ]);

  const sendKey = useCallback(
    (type: "down" | "up", usage: number) => {
      queueKeyboard(() =>
        hostDeviceMotionRequest({
          device: config.device,
          command: "key",
          usage,
          phase: type,
        }),
      );
    },
    [config.device, queueKeyboard],
  );
  const sendClipboardShortcut = useCallback(
    (action: "copy" | "cut" | "paste") => {
      queueKeyboard(() =>
        hostDeviceMotionRequest({
          device: config.device,
          command: "clipboard",
          clipboardAction: action,
        }),
      );
    },
    [config.device, queueKeyboard],
  );

  // Subscribe to app-state SSE.
  const [detectedApp, setDetectedApp] = useState<DetectedAppState | null>(null);
  const currentApp = currentAppForDevice(detectedApp, config.device);
  const goHome = useCallback(() => {
    goHomeAndSelectSpringBoard(config.device, () => onStreamButton("home"), setDetectedApp);
  }, [config.device, onStreamButton]);
  const [uiSettingsRevision, refreshUiSettings] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => {
    pendingStreamModeRef.current = null;
    setStreamMode("perf");
  }, [config.device]);
  // SimulatorView emits Connection Stats here; the panel registers its sink so
  // only the panel re-renders on the 1 Hz cadence, not this whole tree.
  const serverStatsRef = useRef<ServerStreamStats | null>(null);
  useEffect(() => {
    serverStatsRef.current = null;
  }, [config.device, config.streamUrl]);
  const statsSinkRef = useRef<((snap: ConnectionStats) => void) | null>(null);
  // The toolbar's fps readout subscribes the same way.
  const fpsSinkRef = useRef<((fps: number) => void) | null>(null);
  const handleConnectionStats = useCallback((snap: ConnectionStats) => {
    fpsSinkRef.current?.(snap.fps);
    // Merge server-pushed adaptive state (arrives on this WS, tag 0x83) into the
    // snapshot SimulatorView emits — in relay mode its own `server` is null.
    statsSinkRef.current?.({ ...snap, server: snap.server ?? serverStatsRef.current });
  }, []);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 0,
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
        const next = JSON.parse(e.data) as {
          bundleId: string;
          pid?: number;
          isReactNative: boolean;
        };
        if (timer) clearTimeout(timer);
        const delay = next?.isReactNative ? 0 : 600;
        timer = setTimeout(() => {
          setDetectedApp({ ...next, device: config.device });
        }, delay);
      } catch {}
    };
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [config.appStateEndpoint, config.device]);

  // Reload the RN/Expo bundle. See reactNativeReloadKeys — plain R, no Cmd.
  const sendReactNativeReload = useCallback(async () => {
    for (const [index, key] of reactNativeReloadKeys().entries()) {
      if (index > 0) await new Promise((r) => setTimeout(r, 30));
      sendKey(key.type, key.usage);
    }
  }, [sendKey]);

  const simContainerRef = useRef<HTMLDivElement | null>(null);
  const recordingSourceRef = useRef<SimulatorRecordingSource | null>(null);
  const duoRecordingSourceRef = useRef<SimulatorRecordingSource | null>(null);
  const [simFocused, setSimFocused] = useState(true);
  const simFocusedRef = useRef(true);
  simFocusedRef.current = simFocused || keyboardCapture;
  const pressedKeysRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const inside = !!simContainerRef.current?.contains(e.target as Node);
      if (inside && !isPreviewControlTarget(e.target))
        (document.activeElement as HTMLElement | null)?.blur();
      setSimFocused(inside);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    if (simFocused || keyboardCapture) return;
    releasePressedKeys(pressedKeysRef.current, (usage) => sendKey("up", usage));
  }, [simFocused, keyboardCapture, sendKey]);

  useEffect(() => {
    // Unload can close the control socket before queued keyups reach the guest.
    for (let usage = 0xe0; usage <= 0xe7; usage++) sendKey("up", usage);
    const release = () =>
      releasePressedKeys(pressedKeysRef.current, (usage) => sendKey("up", usage));
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      release();
      window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sendKey]);

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
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
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
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!typing) {
          e.preventDefault();
          if (type === "down" && !e.repeat) void captureAndDownloadScreenshot();
          return;
        }
      }
      // ⌥⌘K toggles the on-screen software keyboard (Simulator.app's I/O →
      // Keyboard → Toggle Software Keyboard). ⌘K itself opens the palette.
      if (isSoftwareKeyboardShortcut(e) && !isTextEntryTarget(e.target)) {
        e.preventDefault();
        if (type === "down" && !e.repeat) toggleSoftwareKeyboard();
        return;
      }
      const action = clipboardShortcut(e);
      if (action && simFocusedRef.current && !isPreviewControlTarget(e.target)) {
        e.preventDefault();
        if (type === "down" && !e.repeat) {
          releasePressedKeys(pressedKeysRef.current, (usage) => sendKey("up", usage));
          sendClipboardShortcut(action);
        }
        return;
      }
      if (simFocusedRef.current && !isPreviewControlTarget(e.target))
        syncKeyboardModifiers(e, pressedKeysRef.current, sendKey);
      const heldUsage = hidUsageForCode(e.code);
      if (type === "up" && heldUsage != null && pressedKeysRef.current.delete(heldUsage)) {
        sendKey(type, heldUsage);
        return;
      }
      if (!simFocusedRef.current || isPreviewControlTarget(e.target)) return;
      if (e.code === "KeyH" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        if (type === "down" && !e.repeat) goHome();
        return;
      }
      const usage = hidUsageForCode(e.code);
      if (usage == null) return;
      e.preventDefault();
      if (type === "down") pressedKeysRef.current.add(usage);
      else pressedKeysRef.current.delete(usage);
      sendKey(type, usage);
      // Only key-down: logging both halves doubles the window for no signal.
      if (type === "down" && !e.repeat) logEvent({ kind: "key", details: { type, usage } });
    };
    const down = (e: KeyboardEvent) => onKey(e, "down");
    const up = (e: KeyboardEvent) => onKey(e, "up");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [
    sendKey,
    sendClipboardShortcut,
    config.device,
    toggleAppearance,
    captureAndDownloadScreenshot,
    goHome,
    toggleSoftwareKeyboard,
    logEvent,
  ]);

  // `switching` commits a frame later; a second click before then must wait too.
  const switchingRef = useRef(false);
  const switchToDevice = useCallback(
    /** Resolves whether the window switched. */
    async (
      d: SimDevice,
      from?: { rect: DOMRect | null; frame: HTMLCanvasElement | null },
    ): Promise<boolean> => {
      if (switching || switchingRef.current || d.udid === config.device) return false;
      switchingRef.current = true;
      // From a tile the wall is up; otherwise this device makes way at once.
      // Not in the transition: a prefetched config's swap would land in the
      // same batch, and the recede would never commit.
      if (!from) setDeparting(config.device);
      // Rendered in the background, so the click's first frame paints now.
      startTransition(() => setSwitching(true));
      try {
        const startEndpoint = config.gridStartEndpoint;
        if (!startEndpoint) throw new Error("Simulator start endpoint is unavailable");
        const start = async () => {
          const response = await fetch(startEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ udid: d.udid }),
          });
          const result = (await response.json().catch(() => null)) as {
            ok?: boolean;
            error?: string;
          } | null;
          if (!response.ok || !result?.ok) {
            throw new Error(result?.error || "Failed to start headless-serve-sim");
          }
        };
        handOffStage({ from: from?.rect ?? null, frame: from?.frame ?? null });
        // The swap itself clears `switching` and `departing`.
        await switchWhileStarting(start, () => onSwitchDevice(d.udid));
        return true;
      } catch (err) {
        switchingRef.current = false;
        setSwitching(false);
        setDeparting(null);
        takeStageHandoff();
        toast({
          title: `Couldn't switch to ${d.name}`,
          detail: err instanceof Error ? err.message : String(err),
          tone: "danger",
        });
        return false;
      }
    },
    [
      switching,
      config.device,
      config.gridStartEndpoint,
      setSwitching,
      setDeparting,
      onSwitchDevice,
      toast,
    ],
  );

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

  const stopDevice = useCallback(
    async (udid: string) => {
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
    },
    [fetchDevices, setStoppingUdids],
  );

  // ── Layout ───────────────────────────────────────────────────────────
  // Navigator · Stage · Inspector, with the Console drawer under the stage.
  // Panels are floating glass inset from the window; opening one re-fits the
  // stage on a spring so the device glides rather than jumps. Narrow windows
  // float the panels over the stage instead of squeezing it.
  const overlayPanels = viewportWidth < 1080;
  const stageLeft = navigatorOpen && !overlayPanels ? NAV_W + GAP * 2 : 0;
  const stageRight = inspectorOpen && !overlayPanels ? INS_W + GAP * 2 : 0;
  const insetBottom = consoleOpen ? consoleHeight + GAP : 0;
  useEffect(() => {
    publishStageLayout({
      navigatorOpen,
      inspectorOpen,
      inspectorTab,
      consoleOpen,
      consoleTab,
      consoleHeight,
    });
  }, [navigatorOpen, inspectorOpen, inspectorTab, consoleOpen, consoleTab, consoleHeight]);
  // The device glides as the console rises: the inset it fits against
  // springs from where it is now, so the device re-fits every frame instead
  // of jumping to its final size.
  const [stageInset, setStageInset] = useState(insetBottom);
  const stageInsetRef = useRef(insetBottom);
  useEffect(() => {
    const anim = animate(stageInsetRef.current, insetBottom, {
      ...spring.surface,
      onUpdate: (v) => {
        stageInsetRef.current = v;
        setStageInset(v);
      },
    });
    return () => anim.stop();
  }, [insetBottom]);

  // Wall → stage: the tile you clicked flies into place as the same object.
  const deviceRef = useRef<HTMLDivElement>(null);
  const flyX = useMotionValue(0);
  const flyY = useMotionValue(0);
  const flyScale = useMotionValue(1);
  const flyRotate = useMotionValue(0);
  // What hangs under the device (shadow, dock) rides with a turn.
  const dockLift = useMotionValue(0);
  // The contact shadow widens or narrows with the turn instead of snapping.
  const shadowWidth = useMotionValue(1);
  // The visible device within the device box (the Duo draws inside a larger one).
  const visibleRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const flyFrom = useCallback(
    (tile: DOMRect) => {
      const el = deviceRef.current;
      const stage = stageRef.current;
      const v = visibleRef.current;
      if (!el || !stage || !v.width) return;
      // Layout, not the device's rect: under the wall the stage is scaled.
      const s = stage.getBoundingClientRect();
      const box = {
        left: s.left + el.offsetLeft,
        top: s.top + el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
      const start = flightStart(tile, box, v);
      flyX.set(start.x);
      flyY.set(start.y);
      flyScale.set(start.scale);
      // Motion writes these on its next frame; write the start pose now so
      // the device never paints once at its resting place first.
      if (turnRef.current)
        turnRef.current.style.transform = `translateX(${start.x}px) translateY(${start.y}px) scale(${start.scale}) rotate(${flyRotate.get()}deg)`;
      animate(flyX, 0, spring.surface);
      animate(flyY, 0, spring.surface);
      animate(flyScale, 1, spring.surface);
    },
    [flyX, flyY, flyScale, flyRotate],
  );

  // The stage's live box — measured, so the device tracks the panels' springs.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageBox((prev) =>
        Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const stageWidth = stageBox.width || viewportWidth - stageLeft - stageRight;
  const stageHeight = stageBox.height || viewportHeight - TOOLBAR_H;
  const deviceAvailWidth = Math.max(0, stageWidth - 64);
  const deviceAvailHeight = Math.max(
    0,
    stageHeight - stageInset - DOCK_SPACE - 28 - (foldable ? FOLD_SPACE : 0),
  );

  // Which way the device is turned. Prefer the reported orientation; fall back
  // to comparing the streamed aspect against the profile's native one, exactly
  // as the recorder does, so both agree on the frame's rotation.
  const bezelSpec = selectedFrameSpec ?? config.deviceFrameSpec ?? null;
  const bezelRotation = useMemo(() => {
    const reported = rotationDegreesForOrientation(
      (activeStreamConfig as { orientation?: SimulatorOrientation }).orientation,
    );
    if (reported) return reported;
    if (!bezelSpec || !frameDisplayConfig) return 0;
    const nativeIsLandscape = bezelSpec.nativeScreen.width > bezelSpec.nativeScreen.height;
    const displayIsLandscape = frameDisplayConfig.width > frameDisplayConfig.height;
    return nativeIsLandscape !== displayIsLandscape ? 90 : 0;
  }, [activeStreamConfig, bezelSpec, frameDisplayConfig]);

  const bezelGeom = useMemo(
    () =>
      bezelSpec
        ? fitDeviceBezel({
            spec: bezelSpec,
            rotation: bezelRotation,
            availWidth: deviceAvailWidth,
            availHeight: deviceAvailHeight,
            maxScreenWidth: frameMaxWidth,
            maxScale: SIMULATOR_RESIZE_MAX_SCALE,
            zoom: deviceScale,
          })
        : null,
    [bezelSpec, bezelRotation, deviceAvailWidth, deviceAvailHeight, frameMaxWidth, deviceScale],
  );

  // No installed frame profile (vision, or an Xcode without DeviceKit artwork):
  // fall back to fitting the bare screen, which is all we can draw.
  const frameGeom = useMemo(
    () =>
      fitDeviceFrame({
        viewportWidth: deviceAvailWidth,
        viewportHeight: deviceAvailHeight,
        topBarHeight: 0,
        sideRailsWidth: 0,
        assemblyBorder: 0,
        aspect: frameAspectRatioValue,
        maxWidth: frameMaxWidth,
        maxScale: SIMULATOR_RESIZE_MAX_SCALE,
        zoom: deviceScale,
      }),
    [deviceAvailWidth, deviceAvailHeight, frameAspectRatioValue, frameMaxWidth, deviceScale],
  );

  const fittedDevice = useMemo(
    () =>
      bezelSpec && showBezels
        ? fitDeviceBezel({
            spec: bezelSpec,
            rotation: bezelRotation,
            availWidth: deviceAvailWidth,
            availHeight: deviceAvailHeight,
            maxScreenWidth: frameMaxWidth,
            maxScale: SIMULATOR_RESIZE_MAX_SCALE,
          })
        : fitDeviceFrame({
            viewportWidth: deviceAvailWidth,
            viewportHeight: deviceAvailHeight,
            topBarHeight: 0,
            sideRailsWidth: 0,
            assemblyBorder: 0,
            aspect: frameAspectRatioValue,
            maxWidth: frameMaxWidth,
            maxScale: SIMULATOR_RESIZE_MAX_SCALE,
          }),
    [
      bezelSpec,
      showBezels,
      bezelRotation,
      deviceAvailWidth,
      deviceAvailHeight,
      frameMaxWidth,
      frameAspectRatioValue,
    ],
  );
  const attachScreen = useCallback((node: HTMLDivElement | null) => {
    simContainerRef.current = node;
  }, []);
  const pressHardwareButton = useCallback(
    (press: HardwareButtonPress) => {
      sendHardwareButton(press);
      logEvent({
        kind: "button",
        details: { button: press.button ?? `usage:0x${(press.usage ?? 0).toString(16)}` },
      });
    },
    [sendHardwareButton, logEvent],
  );

  // Where the device sits on the stage. Native Duo composition draws its own
  // body inside the whole available box and reports where it landed.
  const deviceBox = nativeComposition
    ? { width: deviceAvailWidth, height: deviceAvailHeight }
    : {
        width: showBezels && bezelGeom ? bezelGeom.width : frameGeom.width,
        height: showBezels && bezelGeom ? bezelGeom.height : frameGeom.height,
      };
  const deviceLeft = (stageWidth - deviceBox.width) / 2;
  const deviceTop = 14 + Math.max(0, (deviceAvailHeight - deviceBox.height) / 2);
  const visible = nativeComposition
    ? duoBounds
      ? { x: duoBounds.x, y: duoBounds.y, width: duoBounds.width, height: duoBounds.height }
      : { x: 0, y: 0, width: deviceAvailWidth, height: deviceAvailHeight }
    : { x: 0, y: 0, width: deviceBox.width, height: deviceBox.height };
  const deviceBottom = deviceTop + visible.y + visible.height;
  visibleRef.current = visible;

  // Rotation turns the device on the stage, as in the design: the new
  // orientation is drawn at once, then sprung back from the old angle, size
  // and place, so it reads as one object turning rather than a swap.
  const poseRotation = nativeComposition ? 0 : bezelRotation;
  const poseCx = deviceLeft + visible.x + visible.width / 2;
  const poseCy = deviceTop + visible.y + visible.height / 2;
  // The screen inside a bezel; a bare screen is the whole box.
  const framedScreen =
    !nativeComposition && showBezels && bezelSpec && bezelGeom ? bezelGeom.screen : null;
  const screenCx = framedScreen && deviceLeft + framedScreen.x + framedScreen.width / 2;
  const screenCy = framedScreen && deviceTop + framedScreen.y + framedScreen.height / 2;
  const screenWidth = framedScreen?.width;
  const pose = useMemo<StagePose>(
    () => ({
      // The Duo's renderer turns the device itself, frame by frame.
      rotation: poseRotation,
      cx: poseCx,
      cy: poseCy,
      width: visible.width,
      height: visible.height,
      screen:
        screenCx === null || screenCy === null || screenWidth === undefined
          ? undefined
          : { cx: screenCx, cy: screenCy, width: screenWidth },
    }),
    [poseRotation, poseCx, poseCy, visible.width, visible.height, screenCx, screenCy, screenWidth],
  );
  const poseRef = useRef(pose);
  const turnRef = useRef<HTMLDivElement>(null);
  const shadowLiftRef = useRef<HTMLDivElement>(null);
  const shadowWidthRef = useRef<HTMLDivElement>(null);
  const dockLiftRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const prev = poseRef.current;
    poseRef.current = pose;
    if (!prev.width || !pose.width) return;
    if (prev.rotation === pose.rotation) {
      // A one-step resize (the bezel, zoom to fit) glides from the old size;
      // anything else (a drag, the window, the console's spring) tracks.
      if (Date.now() - resizeRequestedAt.current > 1000) return;
      resizeRequestedAt.current = 0;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const drawn: TurnOffsets = {
        rotate: flyRotate.get(),
        scale: flyScale.get(),
        x: flyX.get(),
        y: flyY.get(),
        lift: dockLift.get(),
        footprint: shadowWidth.get(),
      };
      const start = resizeStart(prev, pose, drawn);
      // As for a turn: write the start now so it lands with the new geometry.
      if (turnRef.current)
        turnRef.current.style.transform = `translateX(${start.x}px) translateY(${start.y}px) scale(${start.scale}) rotate(${start.rotate}deg)`;
      for (const el of [shadowLiftRef.current, dockLiftRef.current])
        if (el) el.style.transform = `translateY(${start.lift}px)`;
      if (shadowWidthRef.current)
        shadowWidthRef.current.style.transform = `scaleX(${start.footprint})`;
      // The turn, if one is running, carries on untouched.
      for (const [key, value, rest] of [
        ["scale", flyScale, 1],
        ["x", flyX, 0],
        ["y", flyY, 0],
        ["lift", dockLift, 0],
        ["footprint", shadowWidth, 1],
      ] as const) {
        value.jump(start[key]);
        animate(value, rest, spring.surface);
      }
      return;
    }
    if (Date.now() - rotateRequestedAt.current > 5000) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Start from where the device is drawn now — partway through a turn if one
    // is still running — so a second turn picks it up rather than snapping.
    const drawn: TurnOffsets = {
      rotate: flyRotate.get(),
      scale: flyScale.get(),
      x: flyX.get(),
      y: flyY.get(),
      lift: dockLift.get(),
      footprint: shadowWidth.get(),
    };
    const start = rotationStart(prev, pose, drawn);
    // Motion writes these on its next frame; the new geometry paints on this
    // one. Write the start pose now so the two land together.
    if (turnRef.current)
      turnRef.current.style.transform = `translateX(${start.x}px) translateY(${start.y}px) scale(${start.scale}) rotate(${start.rotate}deg)`;
    for (const el of [shadowLiftRef.current, dockLiftRef.current])
      if (el) el.style.transform = `translateY(${start.lift}px)`;
    if (shadowWidthRef.current)
      shadowWidthRef.current.style.transform = `scaleX(${start.footprint})`;
    // Keep a running turn's speed. The ratios (rest 1) are rescaled to the new
    // pose; the offsets only moved by a constant.
    const channels = (
      [
        ["rotate", flyRotate, 0],
        ["scale", flyScale, 1],
        ["x", flyX, 0],
        ["y", flyY, 0],
        ["lift", dockLift, 0],
        ["footprint", shadowWidth, 1],
      ] as const
    ).map(
      ([key, value, rest]) =>
        [
          key,
          value,
          rest,
          value.getVelocity() * (rest === 1 ? start[key] / (drawn[key] || 1) : 1),
        ] as const,
    );
    // The body turns at once, the way a real phone's hardware turns first and
    // iOS swings the picture inside it, on a physical spring that lands with a
    // touch of settle; a half turn takes a little longer than a quarter.
    // Motion's duration springs drop a moving device's speed, so picking one
    // up mid-turn uses the response and damping spring.rotate stands for.
    const moving = channels.some(([, , , velocity]) => velocity !== 0);
    const response = (2 * Math.PI) / 0.4;
    const transition = moving
      ? { type: "spring" as const, stiffness: response ** 2, damping: 2 * 0.8 * response }
      : {
          ...spring.rotate,
          duration: spring.rotate.duration * Math.sqrt(Math.max(Math.abs(start.rotate), 90) / 90),
        };
    for (const [key, value, rest, velocity] of channels) {
      // jump(), not set(): set() leaves the old animation running.
      value.jump(start[key]);
      animate(value, rest, { ...transition, velocity });
    }
  }, [pose, flyRotate, flyScale, flyX, flyY, dockLift, shadowWidth]);

  // Arriving from the wall: fly in from the tile once the device has a place
  // (a Duo has none until its first composite), holding the tile's last
  // frame on the screen until the new stream paints over it.
  // A Duo's tile draws its whole composite contained in the tile; the device
  // takes off from where that was drawn.
  const [tileRect] = useState(() => {
    const from = handoff?.from;
    const frame = handoff?.frame;
    if (!from || !frame || !nativeComposition) return from ?? null;
    const { box } = fittedRegion("contain", from.width, from.height, frame.width, frame.height);
    return new DOMRect(from.left + box.x, from.top + box.y, box.width, box.height);
  });
  const pendingFlight = useRef(tileRect);
  const fromTile = tileRect !== null;
  const placed = !foldable || duoBounds !== null;
  const [heldFrame, setHeldFrame] = useState(handoff?.frame ?? null);
  const [arrived, setArrived] = useState(false);
  // The held frame shows on the screen only from the pass that puts the
  // device over its tile; before that its screen box is not yet there.
  const [flown, setFlown] = useState(!fromTile);
  useEffect(() => {
    if (!streaming) return;
    setArrived(true);
    // A Duo's stream runs before its composite is drawn; its frame then
    // fades out on the flying device rather than vanishing with its tile.
    if (placed && flown) setHeldFrame(null);
  }, [streaming, placed, flown]);
  // Until then the frame waits where the tile was, so the wall can go at once.
  const holdsTile = fromTile && !placed && heldFrame !== null;
  useLayoutEffect(() => {
    // The Duo cross-fades with its tile as it takes off.
    if (!intro && (placed || holdsTile)) stageArrived({ solid: holdsTile || !nativeComposition });
    if (!placed) return;
    const tile = pendingFlight.current;
    pendingFlight.current = null;
    if (tile) {
      flyFrom(tile);
      setFlown(true);
    }
  }, [placed, holdsTile, flyFrom, intro, nativeComposition]);
  // The stage fades and shrinks back under the wall; what hangs under the
  // device fades on its own, so a device flying out of its tile stays solid.
  const stageLayerRef = useRef<HTMLDivElement>(null);
  const stageFade = useMotionValue(1);
  const stageShrink = useMotionValue(1);
  const underFade = useMotionValue(1);
  const closingOnto = useRef(false);
  useEffect(() => {
    if (closingOnto.current) {
      closingOnto.current = false;
      return;
    }
    if (wallOpen && stageLayerRef.current) stageLayerRef.current.style.zIndex = "";
    animate(stageFade, wallOpen ? 0 : 1, spring.surface);
    animate(stageShrink, wallOpen ? 0.96 : 1, spring.surface);
  }, [wallOpen, stageFade, stageShrink]);
  // This window's own tile: the device leaves it as itself, opaque and full
  // size from the first frame, while the wall, shadow and dock crossfade.
  const closeWallOnto = useCallback(
    (tileEl: HTMLElement) => {
      const tile = tileEl.getBoundingClientRect();
      tileEl.style.visibility = "hidden";
      closingOnto.current = true;
      stageFade.jump(1);
      stageShrink.jump(1);
      underFade.jump(0);
      // Motion paints these next frame; the flight's first frame is this one.
      // The device flies over the wall fading out under it.
      if (stageLayerRef.current) {
        stageLayerRef.current.style.opacity = "1";
        stageLayerRef.current.style.transform = "none";
        stageLayerRef.current.style.zIndex = "1";
      }
      for (const el of [shadowLiftRef.current, dockLiftRef.current]) if (el) el.style.opacity = "0";
      animate(underFade, 1, spring.surface);
      flyFrom(tile);
      setWallOpen(false);
    },
    [stageFade, stageShrink, underFade, flyFrom],
  );
  const glowColors = useScreenColors(simContainerRef, streaming && !wallOpen);

  const recording = useScreenRecording({
    sourceRef: nativeComposition ? duoRecordingSourceRef : recordingSourceRef,
    deviceFrameSpec: foldable ? null : recordingDeviceFrameSpec,
    deviceKey: config.device,
    streaming,
    touchMarkersAvailable: !foldable,
    onFinished: ({ blob, filename, meta }) => {
      addCapture({
        kind: "recording",
        createdAt: Date.now(),
        meta,
        url: URL.createObjectURL(blob),
        filename,
        blob,
      });
      toast({ title: "Recording saved", detail: meta, tone: "success" });
    },
  });

  const toggleAxOverlay = useCallback(
    () => setAxOverlayEnabled((enabled) => !enabled),
    [setAxOverlayEnabled],
  );
  const rotate = useCallback(
    () => rotateDevice(rotateLeft(currentOrientation)),
    [rotateDevice, currentOrientation],
  );
  const reloadBundle = useCallback(() => void sendReactNativeReload(), [sendReactNativeReload]);
  const reloadReactNative = currentApp?.isReactNative ? reloadBundle : null;

  // Shell shortcuts. Registered in the capture phase so they win over the
  // keystroke forwarding below, which would otherwise send ⌘J into the guest.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target) || !e.metaKey || e.ctrlKey) return;
      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) fn();
      };
      if (e.code === "Digit0" && e.altKey) run(() => setInspectorOpen((o) => !o));
      else if (e.code === "Digit0" && !e.shiftKey) run(() => setNavigatorOpen((o) => !o));
      else if (e.code === "KeyJ" && !e.shiftKey && !e.altKey) run(() => setConsoleOpen((o) => !o));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setInspectorOpen, setNavigatorOpen]);

  const shell = useMemo<Shell>(
    () => ({
      theme,
      navigatorOpen,
      setNavigatorOpen,
      inspectorOpen,
      setInspectorOpen,
      inspectorTab,
      setInspectorTab,
      consoleOpen,
      setConsoleOpen,
      consoleTab,
      setConsoleTab,
      wallOpen,
      setWallOpen,
      paletteOpen,
      setPaletteOpen,
      device: {
        udid: config.device,
        name: resolvedDeviceName,
        runtime: selectedDevice?.runtime ?? null,
        type: deviceType,
      },
      streaming,
      goHome,
      rotate,
      canRotate: deviceType !== "watch",
      toggleAppearance,
      screenshot: () => void captureAndDownloadScreenshot(),
      toggleSoftwareKeyboard,
      axOverlayEnabled,
      toggleAxOverlay,
      reloadReactNative,
      recording,
      captures,
      addCapture,
      toast,
      updateToast,
      dismissToast,
    }),
    [
      theme,
      navigatorOpen,
      setNavigatorOpen,
      inspectorOpen,
      setInspectorOpen,
      inspectorTab,
      consoleOpen,
      consoleTab,
      wallOpen,
      paletteOpen,
      config.device,
      resolvedDeviceName,
      selectedDevice?.runtime,
      deviceType,
      streaming,
      goHome,
      rotate,
      toggleAppearance,
      captureAndDownloadScreenshot,
      toggleSoftwareKeyboard,
      axOverlayEnabled,
      toggleAxOverlay,
      reloadReactNative,
      recording,
      captures,
      addCapture,
      toast,
      updateToast,
      dismissToast,
    ],
  );

  const inspectorProps: InspectorProps = {
    udid: config.device,
    execToken: config.execToken,
    uiSettingsRevision,
    currentApp,
    foldable,
    displayId: activeStreamConfig.displayId,
    view: {
      bezels: showBezels,
      scale: deviceScale,
      slowAnimations,
      keyboardCapture,
      onKeyboardCaptureChange: setKeyboardCapture,
      onBezelsChange: changeBezels,
      onScaleChange: setDeviceScale,
      onZoomToFit: () => {
        resizeRequestedAt.current = Date.now();
        setDeviceScale(1);
      },
      onSoftwareKeyboard: toggleSoftwareKeyboard,
      onSlowAnimationsChange: (enabled) => {
        setSlowAnimations(enabled);
        sendWs(0x08, { option: "debug_slow_animations", enabled });
      },
    },
    onOrientationChange: (orientation) => {
      rotateRequestedAt.current = turnCommandedAt.current = Date.now();
      orientationEditRef.current++;
      setDuoOrientation(orientation);
      deviceOrientationEdit.current++;
      setDeviceOrientation(orientation);
    },
    recording,
    recordingSourceRef: nativeComposition ? duoRecordingSourceRef : recordingSourceRef,
    deviceFrameSpec: foldable ? null : recordingDeviceFrameSpec,
    streaming,
    metricsEndpoint: config.metricsEndpoint ?? simEndpoint("api/metrics"),
    stream: {
      live: streaming,
      codecMode: useAvccVideo ? "avcc" : "mjpeg",
      streamConfig: activeStreamConfig,
      sinkRef: statsSinkRef,
      mode: streamMode,
      modeAvailable: useAvccVideo,
      onModeChange,
    },
  };

  const uploadToasts = uploads.toasts.map(uploadToastItem);
  const [hiddenUploads, setHiddenUploads] = useState<Set<string>>(new Set());
  const toastItems: ToastItem[] = [
    ...uploadToasts.filter((t) => !hiddenUploads.has(String(t.id))),
    ...toasts,
  ];
  const toastRight = inspectorOpen && !overlayPanels ? INS_W + 30 : 20;
  const bootedCount = devices.filter((d) => d.state === "Booted").length;
  // While the pointer is over the navigator or toolbar, or the palette is
  // open, keep the other running simulators' configs fresh so a pick there
  // switches without waiting on the server's simulator list.
  const [switchIntent, setSwitchIntent] = useState(false);
  const warmOnHover = {
    onPointerEnter: () => setSwitchIntent(true),
    onPointerLeave: () => setSwitchIntent(false),
  };
  const switchTargets = devices
    .filter((d) => d.state === "Booted" && d.udid !== config.device)
    .map((d) => d.udid)
    .join(" ");
  useEffect(() => {
    if ((switchIntent || paletteOpen) && switchTargets)
      return keepDeviceConfigsWarm(switchTargets.split(" "));
  }, [switchIntent, paletteOpen, switchTargets]);

  // The Duo has no screen on the stage until its first composite lands.
  const screenless = nativeComposition && !duoBounds;
  const screenOverlays = (
    <>
      <Shutter count={shutter} />
      {reveal && (
        <AppearanceReveal
          key={reveal.id}
          url={reveal.url}
          source={reveal.source}
          onDone={endReveal}
        />
      )}
      <AnimatePresence initial={false}>
        {heldFrame && flown && placed ? (
          <HeldFrame key="held" frame={heldFrame} />
        ) : (
          // A device arrives with its screen dark, and the stream's first
          // frame lights it, rather than flashing the decoder's placeholder.
          !arrived &&
          !nativeComposition && (
            <motion.div
              key="dark"
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[69] bg-black"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            />
          )
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!streaming && !streamError && !heldFrame && (
          <ScreenStatus key="connecting" bare={screenless} />
        )}
        {streamError && <ScreenStatus key="error" error={streamError} bare={screenless} />}
      </AnimatePresence>
      <AnimatePresence>{mediaDrop.isDragOver && <DropOverlay />}</AnimatePresence>
    </>
  );

  const screenContent = (
    <>
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
        onStreamError={setStreamError}
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
        statsEnabled={streaming}
        onConnectionStats={handleConnectionStats}
        recordingSourceRef={recordingSourceRef}
        onDecoderError={onDecoderError}
        onDecoderRecover={onDecoderRecover}
        onStreamScroll={onStreamScroll}
      />
      <AnimatePresence>
        {axOverlayEnabled && !nativeComposition && (
          <AxDomOverlay
            key="ax"
            interfaceOrientation={liveStreamConfig?.interfaceOrientation}
            displayOrientation={activeStreamConfig.orientation}
          />
        )}
      </AnimatePresence>
      {!nativeComposition && screenOverlays}
    </>
  );

  const device = nativeComposition ? (
    <div ref={attachScreen} className="relative size-full" {...mediaDrop.dropZoneProps}>
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{ width: 1, height: 1, overflow: "hidden", visibility: "hidden" }}
      >
        {screenContent}
      </div>
      {/* The Duo's first composite settles in, as a device arriving does;
          flying from its tile it only cross-fades with it as it takes off. */}
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={
          screenless
            ? fromTile
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.94, filter: "blur(6px)" }
            : { opacity: 1, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }
        }
        transition={{ ...spring.surface, opacity: { duration: fromTile ? 0.2 : 0.4 } }}
      >
        <NativeDuoDevice
          sourceRef={recordingSourceRef}
          recordingSourceRef={duoRecordingSourceRef}
          width={deviceAvailWidth}
          height={deviceAvailHeight}
          onTouch={onStreamTouch}
          onMultiTouch={onStreamMultiTouch}
          onScroll={onStreamScroll}
          onButton={onStreamButton}
          axEnabled={axOverlayEnabled}
          includeFrame={showBezels}
          scale={deviceScale}
          streaming={streaming}
          onBoundsChange={updateDuoBounds}
          onOutputSide={changeOutputSide}
        />
      </motion.div>
      <div
        className="pointer-events-none absolute overflow-hidden"
        style={{ left: visible.x, top: visible.y, width: visible.width, height: visible.height }}
      >
        {screenOverlays}
      </div>
      {duoBounds && (
        <div
          ref={duoResizeRef}
          className="pointer-events-none absolute"
          style={{
            left: duoBounds.x,
            top: duoBounds.y,
            width: duoBounds.width,
            height: duoBounds.height,
          }}
        >
          <DeviceResizeHandles
            fittedSize={{ width: duoBounds.fittedWidth, height: duoBounds.fittedHeight }}
            availableSize={{ width: deviceAvailWidth - 24, height: deviceAvailHeight - 24 }}
            scale={deviceScale}
            // The Duo is fitted to the stage at 1; scaling only shrinks it.
            maxScale={1}
            onScaleChange={setDeviceScale}
          />
        </div>
      )}
    </div>
  ) : (
    <>
      {bezelGeom && bezelSpec ? (
        <DeviceBezel
          spec={bezelSpec}
          geometry={
            showBezels
              ? bezelGeom
              : {
                  ...bezelGeom,
                  screen: {
                    ...bezelGeom.screen,
                    width: frameGeom.width,
                    height: frameGeom.height,
                  },
                }
          }
          showFrame={showBezels}
          screenRef={attachScreen}
          onPressButton={pressHardwareButton}
          {...mediaDrop.dropZoneProps}
        >
          {screenContent}
        </DeviceBezel>
      ) : (
        <BareScreen
          width={frameGeom.width}
          height={frameGeom.height}
          screenRef={attachScreen}
          {...mediaDrop.dropZoneProps}
        >
          {screenContent}
        </BareScreen>
      )}
      <DeviceResizeHandles
        fittedSize={fittedDevice}
        availableSize={{ width: deviceAvailWidth - 24, height: deviceAvailHeight - 24 }}
        scale={deviceScale}
        onScaleChange={setDeviceScale}
      />
    </>
  );

  return (
    <ShellContext.Provider value={shell}>
      <TipProvider delay={500}>
        <AxStateProvider
          endpoint={
            axOverlayEnabled || (consoleOpen && consoleTab === "accessibility")
              ? config?.axEndpoint
              : undefined
          }
        >
          <div className="stage-bg fixed inset-0 overflow-hidden">
            <AnimatePresence initial={intro}>
              {navigatorOpen && (
                <motion.aside
                  key="nav"
                  className="glass absolute z-30 overflow-hidden rounded-[24px]"
                  style={{ top: GAP, bottom: GAP, left: GAP, width: NAV_W }}
                  initial={{ x: -NAV_W - GAP * 2, opacity: 0.4 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -NAV_W - GAP * 2, opacity: 0.4 }}
                  transition={spring.surface}
                  {...warmOnHover}
                >
                  <Navigator
                    devices={devices}
                    loading={devicesLoading}
                    error={devicesError}
                    currentUdid={config.device}
                    stoppingUdids={stoppingUdids}
                    switching={switching}
                    onRefresh={() => void fetchDevices()}
                    onSelect={(d) => void switchToDevice(d)}
                    onStop={(udid) => void stopDevice(udid)}
                    initial={navigatorSeed.current}
                  />
                </motion.aside>
              )}
            </AnimatePresence>

            <AnimatePresence initial={intro}>
              {inspectorOpen && (
                <motion.aside
                  key="ins"
                  className="glass absolute z-30 overflow-hidden rounded-[24px]"
                  style={{ top: GAP, bottom: GAP, right: GAP, width: INS_W }}
                  initial={{ x: INS_W + GAP * 2, opacity: 0.4 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: INS_W + GAP * 2, opacity: 0.4 }}
                  transition={spring.surface}
                >
                  <Inspector {...inspectorProps} />
                </motion.aside>
              )}
            </AnimatePresence>

            <motion.main
              className="absolute top-0 bottom-0"
              initial={false}
              animate={{ left: stageLeft, right: stageRight }}
              transition={spring.surface}
            >
              <div
                ref={stageRef}
                className="absolute inset-x-0 bottom-0"
                style={{ top: TOOLBAR_H }}
              >
                {/* The stage stays mounted under the Wall so the stream (and
                    any recording) keeps running while you look at the others. */}
                <motion.div
                  ref={stageLayerRef}
                  className="absolute inset-0"
                  style={{
                    opacity: stageFade,
                    scale: stageShrink,
                    pointerEvents: wallOpen ? "none" : undefined,
                  }}
                  aria-hidden={wallOpen || undefined}
                >
                  <motion.div
                    ref={deviceRef}
                    className="absolute"
                    initial={
                      intro
                        ? { opacity: 0, y: 40, filter: "blur(12px)" }
                        : handoff.from
                          ? false
                          : // Switched without a tile to fly from: the new device
                            // settles in place as the old one fades over it.
                            { opacity: 0, scale: 0.94, filter: "blur(6px)" }
                    }
                    animate={
                      departing
                        ? // The mirror of the settle-in the next device arrives with.
                          { opacity: 0.4, y: 0, scale: 0.97, filter: "blur(4px)" }
                        : {
                            opacity: 1,
                            y: 0,
                            scale: 1,
                            filter: "blur(0px)",
                            // A resting filter keeps the device on its own surface.
                            transitionEnd: { filter: "none" },
                          }
                    }
                    transition={{ ...spring.surface, opacity: { duration: 0.4 } }}
                    style={{
                      left: deviceLeft,
                      top: deviceTop,
                      width: deviceBox.width,
                      height: deviceBox.height,
                    }}
                  >
                    <motion.div
                      ref={turnRef}
                      className="absolute inset-0"
                      // Promoted for good, so a turn doesn't re-rasterize as it lands.
                      style={{
                        x: flyX,
                        y: flyY,
                        scale: flyScale,
                        rotate: flyRotate,
                        willChange: "transform",
                      }}
                    >
                      <div
                        className="absolute"
                        style={{
                          left: visible.x,
                          top: visible.y,
                          width: visible.width,
                          height: visible.height,
                        }}
                      >
                        <ScreenGlow colors={glowColors} pose={pose} />
                      </div>
                      <div className="relative size-full">{device}</div>
                    </motion.div>
                  </motion.div>

                  {/* Contact shadow: the device rests on the stage rather than floating in it. */}
                  <motion.div
                    ref={shadowLiftRef}
                    aria-hidden
                    className="pointer-events-none absolute top-0 left-0"
                    style={{ y: dockLift, opacity: underFade }}
                  >
                    <motion.div
                      className="absolute top-0 left-0 h-[22px]"
                      // Nothing rests on the stage until the Duo's first frame.
                      initial={false}
                      animate={{ opacity: screenless ? 0 : 1 }}
                      transition={{ duration: 0.4 }}
                      style={{
                        transform: `translate(${deviceLeft + visible.x + visible.width * 0.14}px, ${deviceBottom - 12}px)`,
                        width: visible.width * 0.72,
                      }}
                    >
                      <motion.div
                        ref={shadowWidthRef}
                        className="size-full rounded-[50%] bg-black/25 blur-[14px] dark:bg-black/70"
                        style={{ scaleX: shadowWidth }}
                      />
                    </motion.div>
                  </motion.div>

                  {/* Dock rides just under the device's lower edge. */}
                  <motion.div
                    ref={dockLiftRef}
                    className="absolute top-0 left-0 z-20"
                    style={{ y: dockLift, opacity: underFade }}
                  >
                    <div
                      className="flex flex-col items-center gap-2.5"
                      style={{
                        transform: `translate(calc(${stageWidth / 2}px - 50%), ${deviceBottom + 22}px)`,
                      }}
                    >
                      <DeviceDock intro={intro} />
                      {foldable && (
                        <motion.div
                          className="glass-sm w-[400px] max-w-[calc(100vw-48px)] rounded-[22px]"
                          initial={{ opacity: 0, y: 8 }}
                          animate={hingeKnown ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                          transition={{ ...spring.surface, delay: intro ? 0.3 : 0 }}
                        >
                          <DeviceMotionTool
                            disabled={!streaming}
                            angle={hingeAngle}
                            pose={duoPose}
                            onAngleChange={changeHingeAngle}
                            error={foldError}
                          />
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>

                <AnimatePresence>
                  {wallOpen && (
                    <motion.div
                      key="wall"
                      className="absolute inset-0"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <WallScene
                        currentUdid={config.device}
                        insetBottom={insetBottom}
                        currentStill={() => snapshotCanvas(simContainerRef.current)?.canvas ?? null}
                        onFocus={(udid) => {
                          const tileEl = document.querySelector<HTMLElement>(
                            `[data-wall-tile="${CSS.escape(udid)}"]`,
                          );
                          const tile = tileEl?.getBoundingClientRect();
                          if (udid === config.device) {
                            if (tileEl) closeWallOnto(tileEl);
                            else setWallOpen(false);
                            return;
                          }
                          // Another simulator: the wall stays up until its shell
                          // takes over, so the old device never reappears between.
                          const screen = document.querySelector<HTMLElement>(
                            `[data-wall-tile="${CSS.escape(udid)}"] [data-wall-screen]`,
                          );
                          // Sharp at the stage's size, not the tile's.
                          const frame =
                            snapshotCanvas(screen, {
                              width: deviceAvailWidth,
                              height: deviceAvailHeight,
                            })?.canvas ?? null;
                          const target = devices.find((d) => d.udid === udid) ?? {
                            udid,
                            name: udid,
                            state: "Booted",
                            runtime: "",
                          };
                          // The wall answers at once: all but the chosen tile
                          // starts to go, and comes back if the switch fails.
                          const rest = [
                            ...document.querySelectorAll<HTMLElement>("[data-wall-tile]"),
                          ]
                            .map((el) => (el === tileEl ? el.nextElementSibling : el.parentElement))
                            .filter((el): el is HTMLElement => el instanceof HTMLElement);
                          const leaving = animate(rest, { opacity: 0 }, { duration: 0.2 });
                          void switchToDevice(target, { rect: tile ?? null, frame }).then((ok) => {
                            if (ok) return;
                            leaving.stop();
                            animate(rest, { opacity: 1 }, { duration: 0.2 });
                          });
                          // The device lifts off its tile as its flight starts.
                          void stageArrival()?.then(({ solid }) => {
                            if (tileEl && solid) tileEl.style.visibility = "hidden";
                          });
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="absolute inset-x-0 top-0 z-20 pt-[6px]" {...warmOnHover}>
                <Toolbar
                  devices={devices}
                  fpsSinkRef={fpsSinkRef}
                  wallSummary={`${bootedCount} booted`}
                  phoneLink={
                    config.phonePreviewUrl ? (
                      <PhoneLinkButton
                        url={config.phonePreviewUrl}
                        deviceName={resolvedDeviceName ?? "Simulator"}
                      />
                    ) : null
                  }
                  onSelectDevice={(d) => void switchToDevice(d)}
                />
              </div>

              <AnimatePresence initial={intro}>
                {consoleOpen && (
                  <ConsoleDrawer
                    key="console"
                    height={consoleHeight}
                    maxHeight={viewportHeight * 0.62}
                    onHeight={setConsoleHeight}
                  >
                    <ConsolePanel
                      udid={config.device}
                      logsEndpoint={config.logsEndpoint}
                      appProcessId={currentApp?.pid ?? null}
                      devtools={devtools}
                      selectedDevtoolsTargetId={selectedDevtoolsTargetId}
                      onSelectDevtoolsTarget={setSelectedDevtoolsTargetId}
                    />
                  </ConsoleDrawer>
                )}
              </AnimatePresence>
            </motion.main>

            {holdsTile && tileRect && <HeldFrame frame={heldFrame} at={tileRect} />}

            <Toasts
              items={toastItems}
              right={toastRight}
              onDismiss={(id) =>
                typeof id === "number"
                  ? dismissToast(id)
                  : setHiddenUploads((prev) => new Set(prev).add(id))
              }
            />
            <ScreenshotFlight
              flight={flight}
              right={inspectorOpen && !overlayPanels ? INS_W + GAP * 2 : 0}
              onOpen={() => {
                setInspectorOpen(true);
                setInspectorTab("capture");
              }}
              onDone={endFlight}
            />
            <CommandPalette
              devices={devices}
              currentUdid={config.device}
              onSelectDevice={(d) => void switchToDevice(d)}
              phonePreviewUrl={config.phonePreviewUrl}
            />
          </div>
        </AxStateProvider>
      </TipProvider>
    </ShellContext.Provider>
  );
}

/** Upload progress, in the shell's toast shape. */
function uploadToastItem(t: UploadToast): ToastItem {
  if (t.status === "error")
    return { id: t.id, title: t.name, detail: t.message ?? "Upload failed", tone: "danger" };
  if (t.status === "success")
    return {
      id: t.id,
      title: t.kind === "ipa" ? `Installed ${t.name}` : `Added ${t.name} to Photos`,
      tone: "success",
    };
  // While chunks transfer the bar is determinate; the install / addmedia step
  // after it has no progress signal, so it runs indeterminate.
  if (t.progress !== null)
    return {
      id: t.id,
      title: `Uploading ${t.name}`,
      detail: `${Math.round(t.progress * 100)}%`,
      progress: t.progress,
    };
  return {
    id: t.id,
    title: t.kind === "ipa" ? `Installing ${t.name}…` : `Adding ${t.name}…`,
    progress: "indeterminate",
  };
}

/** Width × height from a PNG's IHDR chunk, without decoding the image. */
async function pngSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const view = new DataView(await blob.slice(16, 24).arrayBuffer());
    return { width: view.getUint32(0), height: view.getUint32(4) };
  } catch {
    return null;
  }
}

/**
 * A switched-from tile's last frame, held on the screen until the new stream
 * paints — or, given `at`, where the tile was until the device has a place.
 */
function HeldFrame({ frame, at }: { frame: HTMLCanvasElement; at?: DOMRect }) {
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      // The wall draws every device upright, from the stream's portrait
      // buffer. On a screen that is (or turns) sideways the frame is turned
      // the way the stream beside it is, or the screen stays dark until then.
      const shape = (w: number, h: number) => (w > h * 1.15 ? 1 : h > w * 1.15 ? -1 : 0);
      const fit = () => {
        const across =
          shape(frame.width, frame.height) * shape(node.clientWidth, node.clientHeight) < 0;
        if (!across) {
          frame.style.cssText = "display:block;width:100%;height:100%";
          node.style.background = "";
          if (frame.parentNode !== node) node.replaceChildren(frame);
          return;
        }
        node.replaceChildren();
        const stream = largestSurface(node.parentElement);
        const angle = stream ? screenCaptureAngle(getComputedStyle(stream).transform) : 0;
        if (Math.abs(Math.abs(angle) - 90) > 1) {
          node.style.background = "#000";
          return;
        }
        frame.style.cssText = `position:absolute;left:50%;top:50%;width:${node.clientHeight}px;height:${node.clientWidth}px;transform:translate(-50%,-50%) rotate(${angle}deg)`;
        node.style.background = "";
        node.replaceChildren(frame);
      };
      fit();
      // Before paint, on the same frame the screen changes shape.
      const observer = new ResizeObserver(fit);
      observer.observe(node);
      return () => observer.disconnect();
    },
    [frame],
  );
  return (
    <motion.div
      ref={attach}
      aria-hidden
      data-held-frame
      className={cn("pointer-events-none z-[72] select-none", at ? "fixed" : "absolute inset-0")}
      style={at && { left: at.left, top: at.top, width: at.width, height: at.height }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    />
  );
}

/**
 * Connecting / stream-error state, quietly over the screen. `bare` is for a
 * device with no screen on the stage yet (the Duo before its first frame):
 * the status floats as a capsule instead of dimming a screen that isn't there.
 */
function ScreenStatus({ error, bare }: { error?: string; bare?: boolean }) {
  return (
    <motion.div
      className={cn(
        "pointer-events-none absolute inset-0 z-[70] flex items-center justify-center p-5",
        !bare && "bg-black/55",
      )}
      initial={{ opacity: 0 }}
      // A healthy stream connects in well under this; only a slow one says so.
      animate={{ opacity: 1, transition: { duration: 0.25, delay: error ? 0 : 0.4 } }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      role={error ? "alert" : "status"}
    >
      {error ? (
        <span className="glass-pop flex max-w-[260px] items-start gap-2 rounded-[14px] px-3 py-2.5 text-footnote text-label [overflow-wrap:anywhere]">
          <TriangleAlert className="mt-px size-4 shrink-0 text-orange" />
          {error}
        </span>
      ) : (
        <span
          className={cn(
            "flex items-center gap-2 text-footnote font-medium",
            bare ? "glass-pop rounded-full py-2 pr-3.5 pl-3 text-label" : "text-white/85",
          )}
        >
          <LoaderCircle className="size-4 animate-spin" />
          Connecting…
        </span>
      )}
    </motion.div>
  );
}

/** Console drawer — rises from the bottom edge and leaves the same way. */
function ConsoleDrawer({
  height,
  maxHeight,
  onHeight,
  children,
}: {
  height: number;
  maxHeight: number;
  onHeight: (h: number) => void;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState<{ y: number; h: number } | null>(null);
  return (
    <motion.section
      className="glass absolute z-20 flex flex-col overflow-hidden rounded-[22px]"
      style={{ left: GAP, right: GAP, bottom: GAP, height }}
      initial={{ y: height + GAP * 2, opacity: 0.5 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: height + GAP * 2, opacity: 0.5 }}
      transition={spring.surface}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize console"
        className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize touch-none justify-center"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ y: e.clientY, h: height });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const raw = drag.h + (drag.y - e.clientY);
          // Past the limits the edge keeps following, but with resistance.
          const next =
            raw < CONSOLE_MIN
              ? CONSOLE_MIN - rubberband(CONSOLE_MIN - raw, 200)
              : raw > maxHeight
                ? maxHeight + rubberband(raw - maxHeight, 200)
                : raw;
          onHeight(next);
        }}
        onPointerUp={() => {
          setDrag(null);
          const clamped = Math.min(maxHeight, Math.max(CONSOLE_MIN, height));
          if (clamped !== height)
            animate(height, clamped, { ...spring.momentum, onUpdate: onHeight });
        }}
      >
        <span
          className="mt-1 h-1 w-9 rounded-full bg-label-4 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ opacity: drag ? 1 : undefined }}
        />
      </div>
      {children}
    </motion.section>
  );
}

const initialPreview = window.__SIM_PREVIEW__;
createRoot(document.getElementById("root")!).render(
  initialPreview?.mode === "phone" ? <PhonePreview config={initialPreview} /> : <App />,
);
