import {
  Camera,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Play,
  RefreshCw,
  Square,
  Webcam,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Field, Note } from "../inspector/device-rows";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { Badge } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import { Disclosure } from "../ui/group";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { execOnHost, shellEscape } from "../utils/exec";
import { fileExtension, uploadFileToTmp } from "../utils/drop";
import { simEndpoint } from "../utils/sim-endpoint";

export type CamSource = "placeholder" | "image" | "video" | "webcam";
type CamMirror = "on" | "off";
export interface CamWebcam {
  id: string;
  name: string;
}

export type CameraPillState = "ready" | "active" | "disconnected";

export const CAMERA_POLL_INTERVAL_MS = 3000;

export const CAMERA_LARGE_VIDEO_BYTES = 200 * 1024 * 1024;
export const CAMERA_LARGE_VIDEO_WARNING = "Large video (>200 MB) — may stutter on shared memory";
export const CAMERA_HEIC_ERROR = "HEIC decode failed — export as JPEG or PNG and retry";

export function nextCameraPillState(current: CameraPillState, pollAlive: boolean): CameraPillState {
  if (pollAlive) return "active";
  if (current === "active") return "disconnected";
  if (current === "disconnected") return "ready";
  return current;
}

export type CameraPrimaryKind = "play" | "stop" | "attach";

export function selectCameraPrimaryKind(input: {
  bundleId: string | null;
  injected: boolean;
  source: CamSource;
  foregroundIsInjected: boolean;
}): CameraPrimaryKind {
  if (!input.injected) return "play";
  if (input.source === "placeholder") return "play";
  if (input.bundleId && !input.foregroundIsInjected) return "attach";
  return "stop";
}

export function parseWebcamListOutput(stdout: string): CamWebcam[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const tab = line.indexOf("\t");
      if (tab <= 0) return [];
      const id = line.slice(0, tab).trim();
      const name = line.slice(tab + 1).trim();
      if (!id || !name) return [];
      return [{ id, name }];
    });
}

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "qt",
  "avi",
  "mkv",
  "webm",
  "mpg",
  "mpeg",
  "3gp",
  "3g2",
  "ts",
  "wmv",
]);

function isVideoFile(file: { type?: string; name?: string }): boolean {
  if (file.type && file.type.startsWith("video/")) return true;
  const name = (file.name ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.has(name.slice(dot + 1));
}

export function isOversizedCameraVideo(file: {
  type?: string;
  name?: string;
  size: number;
}): boolean {
  return isVideoFile(file) && file.size > CAMERA_LARGE_VIDEO_BYTES;
}

export function isHeicLikeFile(input: { type?: string; name?: string }): boolean {
  const type = (input.type ?? "").toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = (input.name ?? "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

export function cameraSourceErrorMessage({
  rawMessage,
  lastFileIsHeic,
  source,
}: {
  rawMessage: string;
  lastFileIsHeic: boolean;
  source: CamSource;
}): string {
  if (lastFileIsHeic && (source === "image" || source === "video")) {
    return CAMERA_HEIC_ERROR;
  }
  return rawMessage;
}

export function CameraStatusPill({ state }: { state: CameraPillState }) {
  return (
    <span className="flex" data-camera-pill-state={state}>
      {state === "active" ? (
        <Badge tone="green" dot>
          Active
        </Badge>
      ) : state === "disconnected" ? (
        <Badge tone="red" dot>
          Disconnected
        </Badge>
      ) : (
        <Badge>Ready</Badge>
      )}
    </span>
  );
}

export function CameraTestPatternHint() {
  return (
    <p className="m-0 text-center text-caption text-label-3" data-camera-test-pattern-hint>
      Test-pattern feed until you pick media
    </p>
  );
}

interface CameraMediaPreviewProps {
  mode: "placeholder" | "file" | "webcam" | "uploading";
  fileName: string | null;
  webcamName: string | null;
  sourceKind: CamSource;
}

/** What the media tile shows for the chosen source. */
export function CameraMediaPreview({
  mode,
  fileName,
  webcamName,
  sourceKind,
}: CameraMediaPreviewProps) {
  if (mode === "uploading") {
    return <span className="text-footnote font-medium text-label-2">Uploading…</span>;
  }
  if (mode === "file" || mode === "webcam") {
    const kind = mode === "webcam" ? "Webcam" : sourceKind === "video" ? "Video" : "Image";
    return (
      <>
        <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label [&_svg]:size-[18px]">
          {mode === "webcam" ? <Webcam /> : sourceKind === "video" ? <Film /> : <ImageIcon />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-body font-medium text-label">
            {(mode === "webcam" ? webcamName : fileName) ?? ""}
          </span>
          <span className="font-mono text-caption2 text-label-3 uppercase">{kind}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <ImagePlus className="size-[18px]" strokeWidth={1.75} />
      <span className="text-footnote font-medium">Choose or drop media</span>
    </>
  );
}

export function CameraInlineBanner({
  kind,
  message,
}: {
  kind: "error" | "warning";
  message: string;
}) {
  return (
    <p
      className={cn(
        "m-0 text-footnote break-words",
        kind === "warning" ? "text-orange" : "text-red",
      )}
      data-camera-banner-kind={kind}
      role={kind === "error" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

/** Reports whether the disclosure body is mounted, i.e. the panel is open. */
function OpenSignal({ onChange }: { onChange: (open: boolean) => void }) {
  useEffect(() => {
    onChange(true);
    return () => onChange(false);
  }, [onChange]);
  return null;
}

/** Select value for the current source; webcams carry their device id. */
export function cameraSourceValue(source: CamSource, webcamId: string): string {
  if (source === "webcam") return `webcam:${webcamId}`;
  if (source === "image" || source === "video") return "file";
  return "placeholder";
}

// ─── Main component ────────────────────────────────────────────────────────

export function CameraTool({
  udid,
  bundleId,
  defaultOpen,
}: {
  udid: string;
  bundleId: string | null;
  defaultOpen?: boolean;
}) {
  // The disclosure owns its open state; bumping the key remounts it open.
  const [openKey, setOpenKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [source, setSource] = useState<CamSource>("placeholder");
  const [filePath, setFilePath] = useState<string>("");
  const [droppedFileName, setDroppedFileName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCountRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [webcams, setWebcams] = useState<CamWebcam[]>([]);
  const [webcamLoading, setWebcamLoading] = useState(false);
  const [webcamId, setWebcamId] = useState<string>("");
  const [mirror, setMirror] = useState<CamMirror>("off");
  const [pendingPrimary, setPendingPrimary] = useState<"inject" | "stop" | null>(null);
  const [pendingAux, setPendingAux] = useState<"mirror" | "switch" | null>(null);
  const isBusy = pendingPrimary !== null || pendingAux !== null;
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [, setStatus] = useState<string | null>(null);
  const [injected, setInjected] = useState(false);
  const [pillState, setPillState] = useState<CameraPillState>("ready");
  const [injectedBundleIds, setInjectedBundleIds] = useState<Set<string>>(() => new Set());
  const [attachedHelperPid, setAttachedHelperPid] = useState<number | null>(null);
  const [webcamAutoInjectRequest, setWebcamAutoInjectRequest] = useState<string | null>(null);
  const lastFileIsHeicRef = useRef(false);
  const skipNextAutoSwapRef = useRef(false);
  const appliedMirrorRef = useRef<CamMirror>("off");
  const autoOpenedForInjectionRef = useRef(false);

  const cliPrefix = useMemo(() => {
    // No window while server-rendering (tests); fall back to the PATH binary.
    const bin = typeof window === "undefined" ? undefined : window.__SIM_PREVIEW__?.serveSimBin;
    if (!bin) return "headless-serve-sim";
    if (/\.ts$/.test(bin)) return `bun ${shellEscape(bin)}`;
    if (/\.js$/.test(bin)) return `node ${shellEscape(bin)}`;
    return shellEscape(bin);
  }, []);

  // Read the helper's status straight off the preview server, which talks to
  // the camera helper's control socket. This is polled on a timer, and the old
  // route through /exec spawned a runtime plus the whole CLI on every tick to
  // fetch one line of JSON.
  const fetchCameraStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${simEndpoint("camera/status")}?device=${encodeURIComponent(udid)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return null;
      return (await res.json()) as {
        alive?: boolean;
        source?: string;
        arg?: string;
        mirror?: string;
        helperPid?: number;
        bundleIds?: string[];
      };
    } catch {
      return null;
    }
  }, [udid]);

  const refreshWebcamsRef = useRef<() => Promise<void>>(async () => {});
  const bundleIdRef = useRef<string | null>(bundleId);
  useEffect(() => {
    bundleIdRef.current = bundleId;
  }, [bundleId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reply = await fetchCameraStatus();
      if (cancelled || !reply || !reply.alive) return;
      skipNextAutoSwapRef.current = true;
      const replySource = reply.source;
      if (
        replySource === "placeholder" ||
        replySource === "webcam" ||
        replySource === "image" ||
        replySource === "video"
      ) {
        setSource(replySource);
      }
      if ((replySource === "image" || replySource === "video") && reply.arg) {
        setFilePath(reply.arg);
        setDroppedFileName(reply.arg.split("/").pop() ?? null);
      }
      if (replySource === "webcam" && reply.arg) {
        setWebcamId(reply.arg);
        void refreshWebcamsRef.current();
      }
      const replyMirror: CamMirror = reply.mirror === "on" ? "on" : "off";
      setMirror(replyMirror);
      appliedMirrorRef.current = replyMirror;
      setAttachedHelperPid(reply.helperPid ?? null);
      setInjected(true);
      const replyBundles = Array.isArray(reply.bundleIds) ? reply.bundleIds : [];
      if (replyBundles.length > 0) setInjectedBundleIds(new Set(replyBundles));
      const fg = bundleIdRef.current;
      const replyHasRealSource = replySource && replySource !== "placeholder";
      setPillState(fg && replyBundles.includes(fg) && replyHasRealSource ? "active" : "ready");
      setStatus(
        `Reattached → ${replySource ?? "running helper"}${reply.arg ? ` (${reply.arg})` : ""}`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [udid, fetchCameraStatus]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const reply = await fetchCameraStatus();
        if (cancelled) return;
        const alive = !!reply?.alive;
        const replyBundles = Array.isArray(reply?.bundleIds) ? reply.bundleIds : null;
        const foregroundIsInjected =
          !!bundleId &&
          (replyBundles ? replyBundles.includes(bundleId) : injectedBundleIds.has(bundleId));
        const replySource = reply?.source ?? null;
        const replyHasRealSource = replySource && replySource !== "placeholder";
        const attachedToCurrentHelper =
          injected &&
          alive &&
          foregroundIsInjected &&
          !!replyHasRealSource &&
          (attachedHelperPid == null || reply?.helperPid === attachedHelperPid);
        setPillState((prev) => nextCameraPillState(prev, attachedToCurrentHelper));
        if (!alive) {
          setInjected((prevInjected) => {
            if (!prevInjected) return prevInjected;
            setInjectedBundleIds(new Set());
            setAttachedHelperPid(null);
            appliedMirrorRef.current = "off";
            return false;
          });
        } else if (
          injected &&
          attachedHelperPid != null &&
          reply?.helperPid !== attachedHelperPid
        ) {
          setInjected(false);
          setInjectedBundleIds(new Set());
          setAttachedHelperPid(null);
          appliedMirrorRef.current = "off";
        } else if (alive && Array.isArray(reply?.bundleIds)) {
          const next = reply.bundleIds;
          setInjectedBundleIds((prev) => {
            if (prev.size === next.length && next.every((b) => prev.has(b))) return prev;
            return new Set(next);
          });
        }
      } finally {
        inFlight = false;
      }
    };

    timer = setInterval(() => {
      void tick();
    }, CAMERA_POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [fetchCameraStatus, injected, attachedHelperPid, bundleId, injectedBundleIds]);

  const refreshWebcams = useCallback(async () => {
    setWebcamLoading(true);
    setError(null);
    try {
      const res = await execOnHost(`${cliPrefix} camera --list-webcams`);
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `--list-webcams failed (${res.exitCode})`);
        return;
      }
      const list = parseWebcamListOutput(res.stdout);
      setWebcams(list);
      if (list.length > 0 && !webcamId) setWebcamId(list[0]!.id);
    } finally {
      setWebcamLoading(false);
    }
  }, [webcamId, cliPrefix]);

  useEffect(() => {
    refreshWebcamsRef.current = refreshWebcams;
  }, [refreshWebcams]);

  useEffect(() => {
    if (panelOpen && webcams.length === 0 && !webcamLoading) {
      void refreshWebcams();
    }
  }, [panelOpen, webcams.length, webcamLoading, refreshWebcams]);

  const reportSourceError = useCallback(
    (rawMessage: string) => {
      setError(
        cameraSourceErrorMessage({
          rawMessage,
          lastFileIsHeic: lastFileIsHeicRef.current,
          source,
        }),
      );
    },
    [source],
  );

  const pushSwitch = useCallback(
    async (nextSource: CamSource, nextWebcamId: string, nextFilePath: string): Promise<boolean> => {
      const isFile = nextSource === "image" || nextSource === "video";
      const argv = ["camera", "switch", isFile ? "file" : nextSource];
      if (nextSource === "webcam" && nextWebcamId) argv.push(shellEscape(nextWebcamId));
      if (isFile) {
        if (!nextFilePath.trim()) {
          setError("Drop a file into the panel or pick another source.");
          return false;
        }
        argv.push(shellEscape(nextFilePath.trim()));
      }
      argv.push("-d", udid, "--quiet");
      const res = await execOnHost(`${cliPrefix} ${argv.join(" ")}`);
      if (res.exitCode !== 0) {
        reportSourceError(
          res.stderr.trim() || res.stdout.trim() || `switch failed (${res.exitCode})`,
        );
        return false;
      }
      lastFileIsHeicRef.current = false;
      try {
        const json = JSON.parse(res.stdout.trim()) as { source?: string; arg?: string };
        setStatus(`Switched → ${json.source ?? nextSource}${json.arg ? ` (${json.arg})` : ""}`);
      } catch {
        setStatus(`Switched → ${nextSource}`);
      }
      return true;
    },
    [udid, cliPrefix, reportSourceError],
  );

  const inject = useCallback(async () => {
    if (!bundleId) return;
    setPendingPrimary("inject");
    setError(null);
    setStatus(null);
    try {
      const flags: string[] = ["camera", shellEscape(bundleId), "-d", udid, "--quiet"];
      if (source === "image" || source === "video") {
        if (!filePath.trim()) {
          setError("Drop a file into the panel or pick another source.");
          return;
        }
        flags.push("--file", shellEscape(filePath.trim()));
      } else if (source === "webcam") {
        if (webcamId) flags.push("--webcam", shellEscape(webcamId));
        else flags.push("--webcam");
      }
      flags.push(`--mirror`, mirror);
      const res = await execOnHost(`${cliPrefix} ${flags.join(" ")}`);
      if (res.exitCode !== 0) {
        reportSourceError(
          res.stderr.trim() || res.stdout.trim() || `inject failed (${res.exitCode})`,
        );
        return;
      }
      lastFileIsHeicRef.current = false;
      let helperPid: number | null = null;
      try {
        const json = JSON.parse(res.stdout.trim()) as {
          source?: string;
          pid?: number;
          helperPid?: number;
          hotSwapped?: boolean;
          helperRelaunched?: boolean;
        };
        helperPid = json.helperPid ?? null;
        const verb = json.helperRelaunched === false ? "Attached" : "Injected";
        const pidStr = json.pid ? ` pid ${json.pid}` : "";
        const helper = json.helperPid ? `, helper pid ${json.helperPid}` : "";
        setStatus(`${verb} ${json.source ?? source} into ${bundleId}${pidStr}${helper}`);
      } catch {
        setStatus(res.stdout.trim() || "Injected.");
      }
      setInjected(true);
      setPillState(source === "placeholder" ? "ready" : "active");
      setAttachedHelperPid(helperPid);
      setInjectedBundleIds((prev) => (prev.has(bundleId) ? prev : new Set(prev).add(bundleId)));
      appliedMirrorRef.current = mirror;
    } finally {
      setPendingPrimary(null);
    }
  }, [bundleId, udid, source, filePath, webcamId, mirror, cliPrefix, reportSourceError]);

  const autoSwapKey = injected
    ? `${source}::${source === "webcam" ? webcamId : ""}::${source === "image" || source === "video" ? filePath : ""}`
    : null;

  const foregroundIsInjected = !!bundleId && injectedBundleIds.has(bundleId);
  const foregroundIsStreaming = foregroundIsInjected && source !== "placeholder";
  useEffect(() => {
    if (!foregroundIsStreaming) {
      autoOpenedForInjectionRef.current = false;
      return;
    }
    if (autoOpenedForInjectionRef.current) return;
    autoOpenedForInjectionRef.current = true;
    setOpenKey((k) => k + 1);
  }, [foregroundIsStreaming]);

  useEffect(() => {
    if (!webcamAutoInjectRequest) return;
    if (!bundleId || isBusy || uploading) return;
    if (source !== "webcam" || webcamId !== webcamAutoInjectRequest) return;
    setWebcamAutoInjectRequest(null);
    if (injected) return;
    void inject();
  }, [webcamAutoInjectRequest, bundleId, isBusy, uploading, source, webcamId, injected, inject]);

  useEffect(() => {
    if (!injected) return;
    if ((source === "image" || source === "video") && !filePath.trim()) return;
    if (source === "webcam" && !webcamId) return;
    if (skipNextAutoSwapRef.current) {
      skipNextAutoSwapRef.current = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      setPendingAux("switch");
      setError(null);
      try {
        if (cancelled) return;
        await pushSwitch(source, webcamId, filePath);
      } finally {
        if (!cancelled) setPendingAux(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSwapKey]);

  useEffect(() => {
    if (!injected) return;
    if (appliedMirrorRef.current === mirror) return;
    const target = mirror;
    let cancelled = false;
    void (async () => {
      setPendingAux("mirror");
      setError(null);
      try {
        const res = await execOnHost(`${cliPrefix} camera mirror ${target} -d ${udid} --quiet`);
        if (cancelled) return;
        if (res.exitCode !== 0) {
          setError(res.stderr.trim() || res.stdout.trim() || `mirror failed (${res.exitCode})`);
          return;
        }
        appliedMirrorRef.current = target;
        setStatus(`Mirror → ${target}`);
      } finally {
        if (!cancelled) setPendingAux(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror, injected]);

  const stopHelper = useCallback(async () => {
    setPendingPrimary("stop");
    setError(null);
    try {
      const res = await execOnHost(`${cliPrefix} camera --stop-webcam -d ${udid}`);
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `stop-webcam failed (${res.exitCode})`);
        return;
      }
      setStatus("Camera helper stopped.");
      setInjected(false);
      setPillState("ready");
      setInjectedBundleIds(new Set());
      appliedMirrorRef.current = "off";
    } finally {
      setPendingPrimary(null);
    }
  }, [udid, cliPrefix]);

  const handleSourceFile = useCallback(async (file: File) => {
    const isHeic = isHeicLikeFile({ type: file.type, name: file.name });
    const isImage = file.type.startsWith("image/") || isHeic;
    const isVideo =
      file.type.startsWith("video/") || isVideoFile({ type: file.type, name: file.name });
    if (!isImage && !isVideo) {
      lastFileIsHeicRef.current = false;
      setError(`Unsupported file type: ${file.type || file.name}`);
      return;
    }
    setUploading(true);
    setError(null);
    setWarning(null);
    if (isOversizedCameraVideo({ type: file.type, name: file.name, size: file.size })) {
      setWarning(CAMERA_LARGE_VIDEO_WARNING);
    }
    lastFileIsHeicRef.current = isHeic;
    try {
      const ext = fileExtension(file);
      const tmpPath = await uploadFileToTmp(file, "headless-serve-sim-camsrc", ext, execOnHost);
      setDroppedFileName(file.name);
      setSource(isVideo ? "video" : "image");
      setFilePath(tmpPath);
      setStatus(`Loaded ${file.name}`);
    } catch (e: any) {
      if (lastFileIsHeicRef.current) setError(CAMERA_HEIC_ERROR);
      else setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) await handleSourceFile(file);
    },
    [handleSourceFile],
  );

  const clearMedia = useCallback(() => {
    setSource("placeholder");
    setFilePath("");
    setDroppedFileName(null);
    setError(null);
    setWarning(null);
    lastFileIsHeicRef.current = false;
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFilePicked = useCallback(
    async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (file) await handleSourceFile(file);
    },
    [handleSourceFile],
  );

  const selectWebcam = useCallback(
    (webcam: CamWebcam) => {
      setWebcamId(webcam.id);
      setSource("webcam");
      setDroppedFileName(null);
      setError(null);
      lastFileIsHeicRef.current = false;
      if (bundleId) setWebcamAutoInjectRequest(webcam.id);
    },
    [bundleId],
  );

  const toggleMirror = useCallback(() => {
    setMirror((m) => (m === "on" ? "off" : "on"));
  }, []);
  const mirrorDisabled = !injected || source === "placeholder";

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragOver(true);
  }, []);
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const primaryKind = selectCameraPrimaryKind({ bundleId, injected, source, foregroundIsInjected });
  const primary: { onClick: () => void; kind: CameraPrimaryKind } =
    primaryKind === "stop"
      ? { onClick: stopHelper, kind: "stop" }
      : primaryKind === "attach"
        ? { onClick: inject, kind: "attach" }
        : { onClick: inject, kind: "play" };
  const primaryDisabled =
    primaryKind === "stop"
      ? uploading || pendingPrimary !== null
      : !bundleId || uploading || pendingPrimary !== null;
  // Short button text (keeps the bundleId out of the flex-1 label so it can't
  // overflow the ~360px panel) that still surfaces the pending/busy state.
  const primaryText =
    primary.kind === "stop"
      ? pendingPrimary === "stop"
        ? "Stopping…"
        : "Stop"
      : primary.kind === "attach"
        ? pendingPrimary === "inject"
          ? "Injecting…"
          : "Inject"
        : pendingPrimary === "inject"
          ? "Starting…"
          : "Play";

  const isPlaceholder = source === "placeholder";
  const showWebcam = source === "webcam";
  const showFile = (source === "image" || source === "video") && !!droppedFileName;
  const activeWebcamName = showWebcam
    ? (webcams.find((w) => w.id === webcamId)?.name ?? webcamId ?? "Webcam")
    : null;
  const tileMode: CameraMediaPreviewProps["mode"] = uploading
    ? "uploading"
    : showFile
      ? "file"
      : showWebcam
        ? "webcam"
        : "placeholder";

  const sourceOptions = [
    { value: "placeholder", label: "Test pattern" },
    ...webcams.map((w) => ({ value: `webcam:${w.id}`, label: w.name })),
    ...(showWebcam && webcamId && !webcams.some((w) => w.id === webcamId)
      ? [{ value: `webcam:${webcamId}`, label: activeWebcamName ?? webcamId }]
      : []),
    { value: "file", label: "Image or video…" },
  ];
  const onSourceChange = (value: string) => {
    if (value === "placeholder") clearMedia();
    else if (value === "file") openFilePicker();
    else {
      const id = value.slice("webcam:".length);
      selectWebcam(webcams.find((w) => w.id === id) ?? { id, name: id });
    }
  };

  return (
    <Disclosure
      key={openKey}
      title="Camera"
      icon={<Camera />}
      defaultOpen={defaultOpen || openKey > 0}
      status={<CameraStatusPill state={pillState} />}
    >
      <OpenSignal onChange={setPanelOpen} />
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="flex flex-col gap-3"
      >
        <Note>
          Feeds an image, video or webcam into the foreground app's camera. Injecting a dylib
          relaunches the app.
        </Note>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={onFilePicked as any}
        />

        <AnimatePresence mode="popLayout" initial={false}>
          {isPlaceholder && !uploading ? (
            <motion.button
              key="drop"
              type="button"
              onClick={openFilePicker}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              whileTap={{ scale: 0.98 }}
              transition={spring.ui}
              title="No source selected — Play uses a test-pattern feed. Click to pick an image/video, or drop one here."
              className={cn(
                "flex h-[72px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-label-4 text-label-2 transition-colors hover:border-label-3 hover:bg-fill-3",
                isDragOver && "border-label-3 bg-fill-2 text-label",
              )}
            >
              <CameraMediaPreview
                mode="placeholder"
                fileName={null}
                webcamName={null}
                sourceKind={source}
              />
            </motion.button>
          ) : (
            <motion.div
              key="media"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={spring.ui}
              title={
                showWebcam ? `Source: ${activeWebcamName}` : `Source: ${droppedFileName ?? source}`
              }
              className={cn(
                "flex min-h-14 items-center gap-2.5 rounded-[12px] bg-fill-3 p-2 shadow-[inset_0_0_0_0.5px_var(--separator)] transition-colors",
                isDragOver && "bg-fill-2",
                uploading && "cursor-progress justify-center",
              )}
            >
              <CameraMediaPreview
                mode={tileMode}
                fileName={droppedFileName}
                webcamName={activeWebcamName}
                sourceKind={source}
              />
              {!uploading && (
                <button
                  type="button"
                  aria-label="Clear source"
                  title="Clear → placeholder"
                  onClick={clearMedia}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-fill-2 hover:text-label"
                >
                  <X className="size-3.5" strokeWidth={2.25} />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {isPlaceholder && !uploading && <CameraTestPatternHint />}

        <Field label="Source">
          <span className="flex min-w-0 items-center gap-1">
            <IconButton
              label="Refresh cameras"
              size="sm"
              disabled={webcamLoading}
              onClick={() => void refreshWebcams()}
            >
              <RefreshCw />
            </IconButton>
            <Select
              label="Camera source"
              value={cameraSourceValue(source, webcamId)}
              onChange={onSourceChange}
              options={sourceOptions}
              className="w-[148px] min-w-0"
            />
          </span>
        </Field>
        <Field label="Mirror">
          <Switch
            label="Mirror"
            checked={mirror === "on"}
            disabled={mirrorDisabled}
            onChange={toggleMirror}
          />
        </Field>

        <Button
          variant={primary.kind === "stop" ? "secondary" : "primary"}
          size="md"
          block
          icon={primary.kind === "stop" ? <Square /> : <Play />}
          onClick={primary.onClick}
          disabled={primaryDisabled}
          title={
            primary.kind === "stop"
              ? "Stop the camera helper and terminate injected apps"
              : primary.kind === "attach"
                ? `Inject ${bundleId} so it joins the camera feed`
                : !bundleId
                  ? "Bring an app to the foreground first"
                  : "Start: inject the dylib and launch the foreground app with the chosen source"
          }
          aria-pressed={primary.kind === "stop"}
          aria-label={primaryText}
        >
          {primaryText}
        </Button>

        {warning && <CameraInlineBanner kind="warning" message={warning} />}
        {error && <CameraInlineBanner kind="error" message={error} />}
      </div>
    </Disclosure>
  );
}
