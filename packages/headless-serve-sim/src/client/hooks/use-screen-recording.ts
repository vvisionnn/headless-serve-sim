import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
  DeviceFrameSpec,
  DeviceType,
  SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import type { NativeStreamRecorder } from "../native-stream-recorder";
import { simEndpoint } from "../utils/sim-endpoint";
import {
  CanvasScreenRecorder,
  supportedRecordingMimeTypes,
  type RecordingArtifact,
  type RecordingFormat,
} from "../screen-recorder";
import {
  prepareDeviceFrameArtwork,
  type PreparedDeviceFrameArtwork,
} from "../device-frame-artwork";
import type { RecordingController } from "../shell/shell-context";

// Screen recording lives in client.tsx (not the Capture tab) so the dock, the
// toolbar pill and ⌘K can start and stop it while the tab is unmounted.

type RecordingPhase = "idle" | "starting" | "recording" | "stopping";
type RecordingDeviceFrame = DeviceFrameSpec | DeviceType | null | undefined;
type FrameArtworkState = {
  key: string;
  loading: boolean;
  prepared: PreparedDeviceFrameArtwork | null;
  failed: boolean;
};

export interface ScreenRecordingOptions {
  sourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  deviceFrameSpec: DeviceFrameSpec | DeviceType | null;
  deviceKey: string;
  streaming: boolean;
  touchMarkersAvailable: boolean;
  /** Called once per finished recording so it lands in Recent captures. */
  onFinished?: (file: { blob: Blob; filename: string; meta: string }) => void;
}

export interface ScreenRecording extends RecordingController {
  format: RecordingFormat;
  setFormat: (format: RecordingFormat) => void;
  support: Record<RecordingFormat, boolean>;
  touchMarkersAvailable: boolean;
  showTouches: boolean;
  setShowTouches: (on: boolean) => void;
  /** False when the simulator has no frame profile at all. */
  deviceFrameAvailable: boolean;
  deviceFrame: boolean;
  setDeviceFrame: (on: boolean) => void;
  frameDescription: string;
  artworkLoading: boolean;
  /** Last finished recording; cleared when a new one starts. */
  artifact: RecordingArtifact | null;
  error: string | null;
  /** Why recording can't start right now, if it's the browser or stream. */
  notice: string | null;
}

function isExactDeviceFrame(frame: RecordingDeviceFrame): frame is DeviceFrameSpec {
  return typeof frame === "object" && frame !== null;
}

function frameArtworkKey(deviceKey: string, frame: RecordingDeviceFrame): string {
  if (isExactDeviceFrame(frame) && frame.artwork) {
    return `${deviceKey}:${frame.deviceTypeIdentifier}:${frame.chromeIdentifier}:${frame.artwork.width}x${frame.artwork.height}`;
  }
  return `${deviceKey}:${frame ?? "procedural"}`;
}

export function recordingFormatSupport(
  isTypeSupported: (mimeType: string) => boolean,
): Record<RecordingFormat, boolean> {
  const mp4 = supportedRecordingMimeTypes("mp4", isTypeSupported).length > 0;
  const webm = supportedRecordingMimeTypes("webm", isTypeSupported).length > 0;
  return { auto: mp4 || webm, mp4, webm };
}

export function frameSelectionAfterDeviceChange(
  selected: boolean,
  previousDeviceKey: string,
  nextDeviceKey: string,
  hasFrameSpec: boolean,
): boolean {
  return selected && previousDeviceKey === nextDeviceKey && hasFrameSpec;
}

export function recordingFrameDescription(
  frame: RecordingDeviceFrame,
  loading: boolean,
  failed: boolean,
): string {
  if (typeof frame === "string") {
    return `Generic ${frame === "iphone" ? "iPhone" : frame === "ipad" ? "iPad" : "Apple Watch"} frame`;
  }
  if (loading) return "Preparing real hardware frame…";
  if (failed) return "Real frame unavailable — using simple frame";
  return frame?.modelName ?? "Unavailable for this simulator";
}

/** The shell's coarser status: what the dock and toolbar pill show. */
export function recordingStatus(phase: RecordingPhase): RecordingController["status"] {
  if (phase === "starting") return "preparing";
  if (phase === "stopping") return "finishing";
  return phase;
}

export function recordingNotice(
  support: Record<RecordingFormat, boolean>,
  streaming: boolean,
): string | null {
  if (!support.auto) return "Screen recording is not supported in this browser.";
  if (!streaming) return "Waiting for the simulator stream.";
  return null;
}

export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** e.g. "0:12 · 4.2 MB · MP4" — the Recent row's caption. */
export function recordingCaptureMeta(
  artifact: Pick<RecordingArtifact, "durationSeconds" | "bytes" | "mimeType">,
): string {
  const container = artifact.mimeType.includes("webm") ? "WebM" : "MP4";
  return `${durationLabel(artifact.durationSeconds)} · ${bytesLabel(artifact.bytes)} · ${container}`;
}

const nativeRecorderModules = new Map<
  string,
  Promise<typeof import("../native-stream-recorder")>
>();

/** The native recorder ships as its own module; load it once, ahead of the first start. */
function loadNativeRecorder() {
  const url = simEndpoint("native-stream-recorder.js");
  let module = nativeRecorderModules.get(url);
  if (!module) {
    module = (import(url) as Promise<typeof import("../native-stream-recorder")>).catch(
      (error: unknown) => {
        nativeRecorderModules.delete(url);
        throw error;
      },
    );
    nativeRecorderModules.set(url, module);
  }
  return module;
}

function browserRecordingSupport(): Record<RecordingFormat, boolean> {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof HTMLCanvasElement === "undefined" ||
    typeof HTMLCanvasElement.prototype.captureStream !== "function"
  ) {
    return { auto: false, mp4: false, webm: false };
  }
  return recordingFormatSupport((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function useScreenRecording({
  sourceRef,
  deviceFrameSpec,
  deviceKey,
  streaming,
  touchMarkersAvailable,
  onFinished,
}: ScreenRecordingOptions): ScreenRecording {
  const [format, setFormat] = useState<RecordingFormat>("auto");
  const [includeTouches, setIncludeTouches] = useState(true);
  const [includeFrame, setIncludeFrame] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [artifact, setArtifact] = useState<RecordingArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameArtwork, setFrameArtwork] = useState<FrameArtworkState>({
    key: "",
    loading: false,
    prepared: null,
    failed: false,
  });
  const recorderRef = useRef<CanvasScreenRecorder | NativeStreamRecorder | null>(null);
  const startRevisionRef = useRef(0);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const deviceKeyRef = useRef(deviceKey);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const nativeRecording = !touchMarkersAvailable && Boolean(sourceRef.current?.subscribeEncoded);
  const browserSupport = browserRecordingSupport();
  const support = nativeRecording ? { ...browserSupport, auto: true, mp4: true } : browserSupport;
  const exactDeviceFrame = isExactDeviceFrame(deviceFrameSpec) ? deviceFrameSpec : null;
  const artworkKey = frameArtworkKey(deviceKey, deviceFrameSpec);
  const artworkLoading = Boolean(
    includeFrame &&
    exactDeviceFrame?.artwork &&
    (frameArtwork.key !== artworkKey || frameArtwork.loading),
  );

  const cancelCurrent = useCallback((message?: string) => {
    startRevisionRef.current++;
    startingRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recorder?.cancel();
    if (!mountedRef.current) return;
    setPhase("idle");
    setStartedAt(null);
    setArtifact(null);
    if (message) setError(message);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => cancelCurrent();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      cancelCurrent();
    };
  }, [cancelCurrent]);

  useEffect(() => {
    const previousDeviceKey = deviceKeyRef.current;
    setIncludeFrame((selected) =>
      frameSelectionAfterDeviceChange(
        selected,
        previousDeviceKey,
        deviceKey,
        deviceFrameSpec != null,
      ),
    );
    if (previousDeviceKey === deviceKey) return;
    deviceKeyRef.current = deviceKey;
    cancelCurrent("Recording cleared because the simulator changed.");
  }, [cancelCurrent, deviceFrameSpec, deviceKey]);

  useEffect(() => {
    const frame = exactDeviceFrame;
    if (!frame?.artwork || !includeFrame) {
      setFrameArtwork({ key: artworkKey, loading: false, prepared: null, failed: false });
      return;
    }
    let cancelled = false;
    setFrameArtwork({ key: artworkKey, loading: true, prepared: null, failed: false });
    void prepareDeviceFrameArtwork(frame).then((prepared) => {
      if (!cancelled) {
        setFrameArtwork({
          key: artworkKey,
          loading: false,
          prepared,
          failed: prepared === null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artworkKey, exactDeviceFrame, includeFrame]);

  useEffect(() => {
    if (streaming || phase === "idle") return;
    cancelCurrent("Recording cancelled because the simulator stream ended.");
  }, [cancelCurrent, phase, streaming]);

  // Warm the recorder once the stream is up, so the first start doesn't stall
  // on fetching and evaluating it.
  useEffect(() => {
    if (!streaming || !nativeRecording) return;
    const warm = () => void loadNativeRecorder().catch(() => {});
    if (typeof requestIdleCallback !== "function") {
      const timer = setTimeout(warm, 500);
      return () => clearTimeout(timer);
    }
    const handle = requestIdleCallback(warm, { timeout: 2_000 });
    return () => cancelIdleCallback(handle);
  }, [streaming, nativeRecording]);

  const start = useCallback(async () => {
    if (startingRef.current || phase !== "idle") return;
    setError(null);
    const source = sourceRef.current;
    if (!source) {
      setError("The simulator screen is not ready yet.");
      return;
    }
    if (artworkLoading) return;

    recorderRef.current?.cancel();
    setArtifact(null);
    const startRevision = ++startRevisionRef.current;
    startingRef.current = true;
    setPhase("starting");
    let recorder: CanvasScreenRecorder | NativeStreamRecorder | null = null;
    const options = {
      source,
      format,
      includeTouches: touchMarkersAvailable && includeTouches,
      deviceFrame: includeFrame ? (deviceFrameSpec ?? null) : null,
      deviceFrameArtwork:
        includeFrame && exactDeviceFrame && frameArtwork.key === artworkKey
          ? frameArtwork.prepared
          : null,
      onError: (nextError: Error) => {
        if (!mountedRef.current || recorderRef.current !== recorder) return;
        recorderRef.current = null;
        setPhase("idle");
        setStartedAt(null);
        setError(nextError.message);
      },
    };
    try {
      if (nativeRecording && format !== "webm") {
        const module = await loadNativeRecorder();
        if (!mountedRef.current || startRevision !== startRevisionRef.current) return;
        if (sourceRef.current !== source) {
          cancelCurrent("Recording cancelled because the simulator stream changed.");
          return;
        }
        recorder = new module.NativeStreamRecorder(options);
      } else recorder = new CanvasScreenRecorder(options);
      recorderRef.current = recorder;
      recorder.start();
      setStartedAt(Date.now());
      setPhase("recording");
    } catch (nextError) {
      recorder?.cancel();
      if (!mountedRef.current || startRevision !== startRevisionRef.current) return;
      recorderRef.current = null;
      setPhase("idle");
      setError(nextError instanceof Error ? nextError.message : "Screen recording failed.");
    } finally {
      if (startRevision === startRevisionRef.current) startingRef.current = false;
    }
  }, [
    artworkKey,
    artworkLoading,
    deviceFrameSpec,
    exactDeviceFrame,
    format,
    frameArtwork,
    includeFrame,
    includeTouches,
    touchMarkersAvailable,
    sourceRef,
    nativeRecording,
    phase,
    cancelCurrent,
  ]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      if (startingRef.current) cancelCurrent();
      return;
    }
    setPhase("stopping");
    setError(null);
    try {
      const result = await recorder.stop();
      if (!mountedRef.current || recorderRef.current !== recorder) return;
      setArtifact(result);
      setPhase("idle");
      setStartedAt(null);
      onFinishedRef.current?.({
        blob: result.blob,
        filename: result.filename,
        meta: recordingCaptureMeta(result),
      });
    } catch (nextError) {
      if (!mountedRef.current || recorderRef.current !== recorder) return;
      recorderRef.current = null;
      setPhase("idle");
      setStartedAt(null);
      setError(nextError instanceof Error ? nextError.message : "Screen recording failed.");
    }
  }, [cancelCurrent]);

  return {
    status: recordingStatus(phase),
    startedAt: phase === "recording" ? startedAt : null,
    available: support[format] && streaming && !artworkLoading,
    start: () => void start(),
    stop: () => void stop(),
    format,
    setFormat,
    support,
    touchMarkersAvailable,
    showTouches: touchMarkersAvailable && includeTouches,
    setShowTouches: setIncludeTouches,
    deviceFrameAvailable: deviceFrameSpec != null,
    deviceFrame: includeFrame,
    setDeviceFrame: setIncludeFrame,
    frameDescription: recordingFrameDescription(
      deviceFrameSpec,
      artworkLoading,
      includeFrame &&
        ((exactDeviceFrame != null && !exactDeviceFrame.artwork) ||
          (frameArtwork.key === artworkKey && frameArtwork.failed)),
    ),
    artworkLoading,
    artifact,
    error,
    notice: recordingNotice(support, streaming),
  };
}

/** Whole seconds since `startedAt`, ticking only while it's set. */
export function useRecordingElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt == null ? 0 : Math.max(0, (now - startedAt) / 1_000);
}
