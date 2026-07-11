import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  DeviceFrameSpec,
  SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import { Chevron } from "../icons";
import {
  StreamModeToggle,
  type StreamMode,
} from "./stream-mode-toggle";
import {
  CanvasScreenRecorder,
  supportedRecordingMimeTypes,
  type RecordingArtifact,
  type RecordingFormat,
} from "../screen-recorder";

type RecordingPhase = "idle" | "recording" | "stopping";

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
  deviceFrameSpec?: DeviceFrameSpec | null;
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
  const recorderRef = useRef<CanvasScreenRecorder | null>(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const deviceKeyRef = useRef(deviceKey);
  const support = browserRecordingSupport();

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
    setIncludeFrame((selected) => frameSelectionAfterDeviceChange(
      selected,
      previousDeviceKey,
      deviceKey,
      deviceFrameSpec != null,
    ));
    if (previousDeviceKey === deviceKey) return;
    deviceKeyRef.current = deviceKey;
    cancelCurrent("Recording cleared because the simulator changed.");
  }, [cancelCurrent, deviceFrameSpec, deviceKey]);

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

    recorderRef.current?.cancel();
    setArtifact(null);
    const recorder = new CanvasScreenRecorder({
      source,
      format,
      includeTouches,
      deviceFrame: includeFrame ? deviceFrameSpec ?? null : null,
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
  }, [deviceFrameSpec, format, includeFrame, includeTouches, sourceRef]);

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
    <div className="overflow-hidden rounded-card border border-divider bg-panel">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-[44px] w-full cursor-pointer select-none items-center justify-between gap-2.5 border-none bg-transparent px-3.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          {busy && <span className="size-2 rounded-full bg-danger" aria-hidden="true" />}
          Screen Recording
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-divider px-3.5 py-3">
          <div className="flex items-center gap-2.5" role="radiogroup" aria-label="Recording format">
            <span className="w-[48px] shrink-0 text-[12px] text-fg-3">Format</span>
            <div className="flex flex-1 gap-0.5 rounded-pill border border-divider bg-surface-2 p-0.5">
              {(["auto", "mp4", "webm"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={format === option}
                  disabled={busy || !support[option]}
                  onClick={() => setFormat(option)}
                  className={`min-h-7 flex-1 cursor-pointer rounded-pill border-none px-2 text-[11px] font-medium focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] ${format === option ? "bg-panel text-fg shadow-sm" : "bg-transparent text-fg-2 hover:bg-hover"} disabled:cursor-not-allowed disabled:text-fg-3`}
                >
                  {option === "auto" ? "Auto" : option === "mp4" ? "MP4" : "WebM"}
                </button>
              ))}
            </div>
          </div>

          {streamModeAvailable && (
            <StreamModeToggle
              label="Stream quality"
              mode={streamMode}
              disabled={!streaming}
              onModeChange={onStreamModeChange}
            />
          )}

          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3 text-[12px] text-fg-2">
            <span>Show touches</span>
            <input
              type="checkbox"
              checked={includeTouches}
              disabled={busy}
              onChange={(event) => setIncludeTouches(event.target.checked)}
              className="size-4 accent-[var(--color-accent-solid)]"
            />
          </label>
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3 text-[12px] text-fg-2 has-[:disabled]:cursor-not-allowed">
            <span className="flex min-w-0 flex-col">
              <span>Device frame</span>
              <span className="truncate text-[10px] text-fg-3">
                {deviceFrameSpec?.modelName ?? "Unavailable for this simulator"}
              </span>
            </span>
            <input
              type="checkbox"
              checked={includeFrame}
              disabled={busy || !deviceFrameSpec}
              onChange={(event) => setIncludeFrame(event.target.checked)}
              className="size-4 accent-[var(--color-accent-solid)]"
            />
          </label>

          {busy ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 flex-1 items-center justify-center gap-2 rounded-pill border border-divider bg-surface-2 text-[12px] font-medium text-fg" role="status">
                <span className="size-2 rounded-full bg-danger" aria-hidden="true" />
                {phase === "stopping" ? "Finishing…" : `Recording ${durationLabel(elapsedSeconds)}`}
              </div>
              <button
                type="button"
                onClick={() => void stop()}
                disabled={phase === "stopping"}
                className="h-8 cursor-pointer rounded-pill border-none bg-danger px-4 text-[12px] font-semibold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:bg-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
              >
                Stop recording
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!support[format] || !streaming}
              className="inline-flex min-h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-pill border-none bg-accent-solid px-4 text-[12px] font-semibold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:bg-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
            >
              <span className="size-2 rounded-full border-2 border-white" aria-hidden="true" />
              Start recording
            </button>
          )}

          {!support.auto && (
            <div className="rounded-card border border-divider bg-surface-2 px-3 py-2 text-[12px] text-fg-2" role="status">
              Screen recording is not supported in this browser.
            </div>
          )}
          {support.auto && !streaming && (
            <div className="rounded-card border border-divider bg-surface-2 px-3 py-2 text-[12px] text-fg-2" role="status">
              Waiting for the simulator stream.
            </div>
          )}
          {error && (
            <div className="rounded-card border border-divider bg-surface-2 px-3 py-2 text-[12px] text-danger" role="alert">
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
              <div className="text-center text-[11px] text-fg-3 [font-variant-numeric:tabular-nums]">
                {artifact.width}×{artifact.height} · {durationLabel(artifact.durationSeconds)} · {bytesLabel(artifact.bytes)}
              </div>
              <a
                href={artifact.url}
                download={artifact.filename}
                className="inline-flex min-h-8 w-full items-center justify-center rounded-pill border border-divider bg-panel px-3 text-[12px] font-medium text-fg-2 no-underline hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
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
