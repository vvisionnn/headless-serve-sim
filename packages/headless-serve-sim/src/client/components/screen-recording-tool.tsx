import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
  DeviceType,
  DeviceFrameSpec,
  SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import { Chevron } from "../icons";
import { SegmentedGroup } from "./design-system";
import { SettingSwitch } from "./setting-switch";
import { StreamModeToggle, type StreamMode } from "./stream-mode-toggle";
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

type RecordingPhase = "idle" | "recording" | "stopping";
type RecordingDeviceFrame = DeviceFrameSpec | DeviceType | null | undefined;
type FrameArtworkState = {
  key: string;
  loading: boolean;
  prepared: PreparedDeviceFrameArtwork | null;
  failed: boolean;
};

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

function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ScreenRecordingTool({
  sourceRef,
  deviceFrameSpec,
  deviceKey,
  streaming,
  streamMode,
  streamModeAvailable,
  onStreamModeChange,
  initiallyOpen = false,
}: {
  sourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  deviceFrameSpec?: RecordingDeviceFrame;
  deviceKey: string;
  streaming: boolean;
  streamMode: StreamMode;
  streamModeAvailable: boolean;
  onStreamModeChange: (mode: StreamMode) => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [format, setFormat] = useState<RecordingFormat>("auto");
  const [includeTouches, setIncludeTouches] = useState(true);
  const [includeFrame, setIncludeFrame] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [artifact, setArtifact] = useState<RecordingArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameArtwork, setFrameArtwork] = useState<FrameArtworkState>({
    key: "",
    loading: false,
    prepared: null,
    failed: false,
  });
  const recorderRef = useRef<CanvasScreenRecorder | null>(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const deviceKeyRef = useRef(deviceKey);
  const support = browserRecordingSupport();
  const exactDeviceFrame = isExactDeviceFrame(deviceFrameSpec) ? deviceFrameSpec : null;
  const artworkKey = frameArtworkKey(deviceKey, deviceFrameSpec);
  const artworkLoading = Boolean(
    includeFrame &&
    exactDeviceFrame?.artwork &&
    (frameArtwork.key !== artworkKey || frameArtwork.loading),
  );

  const cancelCurrent = useCallback((message?: string) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recorder?.cancel();
    if (!mountedRef.current) return;
    setPhase("idle");
    setElapsedSeconds(0);
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
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recorder?.cancel();
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

  useEffect(() => {
    if (phase !== "recording") return;
    const update = () => setElapsedSeconds((performance.now() - startedAtRef.current) / 1_000);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = useCallback(() => {
    setError(null);
    const source = sourceRef.current;
    if (!source) {
      setError("The simulator screen is not ready yet.");
      return;
    }
    if (artworkLoading) return;

    recorderRef.current?.cancel();
    setArtifact(null);
    const recorder = new CanvasScreenRecorder({
      source,
      format,
      includeTouches,
      deviceFrame: includeFrame ? (deviceFrameSpec ?? null) : null,
      deviceFrameArtwork:
        includeFrame && exactDeviceFrame && frameArtwork.key === artworkKey
          ? frameArtwork.prepared
          : null,
      onError: (nextError) => {
        if (!mountedRef.current || recorderRef.current !== recorder) return;
        recorderRef.current = null;
        setPhase("idle");
        setError(nextError.message);
      },
    });
    recorderRef.current = recorder;
    try {
      recorder.start();
      startedAtRef.current = performance.now();
      setElapsedSeconds(0);
      setPhase("recording");
    } catch (nextError) {
      recorderRef.current = null;
      recorder.cancel();
      setError(nextError instanceof Error ? nextError.message : "Screen recording failed.");
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
    sourceRef,
  ]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setPhase("stopping");
    setError(null);
    try {
      const result = await recorder.stop();
      if (!mountedRef.current || recorderRef.current !== recorder) return;
      setArtifact(result);
      setElapsedSeconds(result.durationSeconds);
      setPhase("idle");
    } catch (nextError) {
      if (!mountedRef.current || recorderRef.current !== recorder) return;
      recorderRef.current = null;
      setPhase("idle");
      setError(nextError instanceof Error ? nextError.message : "Screen recording failed.");
    }
  }, []);

  const busy = phase !== "idle";

  return (
    <div className="overflow-hidden border-t border-divider bg-panel">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-[56px] w-full cursor-pointer select-none items-center justify-between gap-2.5 border-none bg-transparent px-5 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="mr-auto flex items-center gap-2 text-body font-semibold text-fg">
          {busy && <span className="size-2 rounded-full bg-danger" aria-hidden="true" />}
          Screen Recording
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-5 pb-4 pt-1">
          <SegmentedGroup
            label="Format"
            ariaLabel="Recording format"
            value={format}
            showValue={false}
            disabled={busy}
            options={[
              { value: "auto", label: "Auto", disabled: !support.auto },
              { value: "mp4", label: "MP4", disabled: !support.mp4 },
              { value: "webm", label: "WebM", disabled: !support.webm },
            ]}
            onChange={setFormat}
          />

          {streamModeAvailable && (
            <StreamModeToggle
              label="Stream quality"
              mode={streamMode}
              disabled={!streaming}
              onModeChange={onStreamModeChange}
            />
          )}

          <SettingSwitch
            label="Show touches"
            checked={includeTouches}
            disabled={busy}
            onChange={setIncludeTouches}
          />
          <SettingSwitch
            label="Device frame"
            decoratedLabel={
              <span className="flex min-w-0 flex-col">
                <span>Device frame</span>
                <span className="truncate text-micro text-fg-3">
                  {recordingFrameDescription(
                    deviceFrameSpec,
                    artworkLoading,
                    includeFrame &&
                      ((exactDeviceFrame != null && !exactDeviceFrame.artwork) ||
                        (frameArtwork.key === artworkKey && frameArtwork.failed)),
                  )}
                </span>
              </span>
            }
            checked={includeFrame}
            disabled={busy || !deviceFrameSpec}
            onChange={setIncludeFrame}
          />

          {busy ? (
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 flex-1 items-center justify-center gap-2 rounded-card border border-divider bg-surface-2 text-value font-medium text-fg"
                role="status"
              >
                <span className="size-2 rounded-full bg-danger" aria-hidden="true" />
                {phase === "stopping" ? "Finishing…" : `Recording ${durationLabel(elapsedSeconds)}`}
              </div>
              <button
                type="button"
                onClick={() => void stop()}
                disabled={phase === "stopping"}
                className="h-8 cursor-pointer rounded-card border-none bg-danger px-4 text-value font-semibold text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:bg-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
              >
                Stop recording
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!support[format] || !streaming || artworkLoading}
              className="inline-flex min-h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-card border-none bg-accent-solid px-4 text-value font-semibold text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:bg-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
            >
              <span className="size-2 rounded-full border-2 border-current" aria-hidden="true" />
              {artworkLoading ? "Preparing frame…" : "Start recording"}
            </button>
          )}

          {!support.auto && (
            <div
              className="rounded-card border border-divider bg-surface-2 px-3 py-2 text-value text-fg-2"
              role="status"
            >
              Screen recording is not supported in this browser.
            </div>
          )}
          {support.auto && !streaming && (
            <div
              className="rounded-card border border-divider bg-surface-2 px-3 py-2 text-value text-fg-2"
              role="status"
            >
              Waiting for the simulator stream.
            </div>
          )}
          {error && (
            <div
              className="rounded-card border border-divider bg-surface-2 px-3 py-2 text-value text-danger"
              role="alert"
            >
              {error}
            </div>
          )}

          {artifact && (
            <div className="flex flex-col gap-2" role="group" aria-label="Screen recording result">
              <video
                src={artifact.url}
                controls
                preload="metadata"
                className="max-h-[220px] w-full rounded-card border border-divider bg-black"
                aria-label="Recorded simulator video"
              />
              <div className="text-center text-micro text-fg-3 [font-variant-numeric:tabular-nums]">
                {artifact.width}×{artifact.height} · {durationLabel(artifact.durationSeconds)} ·{" "}
                {bytesLabel(artifact.bytes)}
              </div>
              <a
                href={artifact.url}
                download={artifact.filename}
                className="inline-flex min-h-8 w-full items-center justify-center rounded-card border border-divider bg-panel px-3 text-value font-medium text-fg-2 no-underline hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
              >
                Download recording
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
