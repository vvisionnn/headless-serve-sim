import {
  DEVICE_FRAMES,
  rotationDegreesForOrientation,
  streamDisplayGeometry,
  type DeviceType,
  type SimulatorRecordingSnapshot,
  type SimulatorRecordingSource,
  type SimulatorRecordingTouch,
  type SimulatorOrientation,
} from "headless-serve-sim-client/simulator";

export type RecordingFormat = "auto" | "mp4" | "webm";

export interface RecordingSourceGeometry {
  width: number;
  height: number;
  orientation?: SimulatorOrientation;
}

export interface RecordingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingLayout {
  width: number;
  height: number;
  screenRect: RecordingRect;
  rotationDegrees: number;
  frameRotationDegrees: number;
  deviceFrame: DeviceType | null;
  frameScale: number;
  frameRotated: boolean;
}

export type RecordingTouch = SimulatorRecordingTouch;
export type RecordingSnapshot = SimulatorRecordingSnapshot;
export type RecordingSource = SimulatorRecordingSource;

export interface RecorderMediaStreamTrack {
  stop(): void;
}

export interface RecorderMediaStream {
  getTracks(): readonly RecorderMediaStreamTrack[];
}

export interface RecorderCanvas {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D | null;
  captureStream(frameRate: number): RecorderMediaStream;
}

export interface RecorderMediaRecorder {
  readonly mimeType: string;
  readonly state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  start(timeslice?: number): void;
  requestData?(): void;
  stop(): void;
}

export interface ScreenRecorderPlatform {
  createCanvas(width: number, height: number): RecorderCanvas;
  createMediaRecorder(
    stream: RecorderMediaStream,
    options: MediaRecorderOptions,
  ): RecorderMediaRecorder;
  isTypeSupported(mimeType: string): boolean;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  /** Monotonic milliseconds, shared with touch tracking and duration math. */
  now(): number;
  /** Epoch milliseconds, used only for the downloaded filename. */
  wallClock(): number;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface CanvasScreenRecorderOptions {
  source: RecordingSource;
  format?: RecordingFormat;
  deviceFrame?: DeviceType | null;
  includeTouches?: boolean;
  fps?: number;
  videoBitsPerSecond?: number;
  onError?: (error: Error) => void;
}

export interface RecordingArtifact {
  blob: Blob;
  url: string;
  filename: string;
  mimeType: string;
  durationSeconds: number;
  bytes: number;
  width: number;
  height: number;
}

export type ScreenRecorderState =
  | "idle"
  | "recording"
  | "stopping"
  | "finished"
  | "cancelled"
  | "error";

const MP4_MIME_TYPES = ["video/mp4;codecs=avc1", "video/mp4"] as const;
const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

function recordingMimeTypeCandidates(format: RecordingFormat): readonly string[] {
  if (format === "mp4") return MP4_MIME_TYPES;
  if (format === "webm") return WEBM_MIME_TYPES;
  return [...MP4_MIME_TYPES, ...WEBM_MIME_TYPES];
}

export function supportedRecordingMimeTypes(
  format: RecordingFormat,
  isTypeSupported: (mimeType: string) => boolean,
): string[] {
  return recordingMimeTypeCandidates(format).filter(isTypeSupported);
}

export function selectRecordingMimeType(
  format: RecordingFormat,
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  return supportedRecordingMimeTypes(format, isTypeSupported)[0] ?? null;
}

export function recordingExtension(mimeType: string): "mp4" | "webm" {
  return mimeType.toLowerCase().startsWith("video/mp4") ? "mp4" : "webm";
}

export function recordingFilename(startedAt: Date, mimeType: string): string {
  const stamp = startedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[-:T]/g, "");
  return `simulator-${stamp}.${recordingExtension(mimeType)}`;
}

function evenCeil(value: number): number {
  return Math.ceil(value / 2) * 2;
}

export function createRecordingLayout(
  source: RecordingSourceGeometry,
  deviceFrame: DeviceType | null = null,
): RecordingLayout {
  const geometry = streamDisplayGeometry(source);
  const display = geometry.displayConfig;
  if (!display) throw new Error("recording source dimensions must be positive");
  if (deviceFrame) {
    const frame = DEVICE_FRAMES[deviceFrame];
    const frameIsLandscape = frame.width > frame.height;
    const displayIsLandscape = display.width > display.height;
    const frameRotated = frameIsLandscape !== displayIsLandscape;
    const outerWidth = frameRotated ? frame.height : frame.width;
    const outerHeight = frameRotated ? frame.width : frame.height;
    const bezelX = frameRotated ? frame.bezelY : frame.bezelX;
    const bezelY = frameRotated ? frame.bezelX : frame.bezelY;
    const innerWidth = outerWidth - 2 * bezelX;
    const innerHeight = outerHeight - 2 * bezelY;
    const frameScale = Math.max(
      display.width / innerWidth,
      display.height / innerHeight,
    );
    const frameWidth = outerWidth * frameScale;
    const frameHeight = outerHeight * frameScale;
    const width = evenCeil(frameWidth);
    const height = evenCeil(frameHeight);
    const offsetX = (width - frameWidth) / 2;
    const offsetY = (height - frameHeight) / 2;
    return {
      width,
      height,
      screenRect: {
        x: offsetX + bezelX * frameScale,
        y: offsetY + bezelY * frameScale,
        width: innerWidth * frameScale,
        height: innerHeight * frameScale,
      },
      rotationDegrees: geometry.rotationDegrees,
      frameRotationDegrees:
        rotationDegreesForOrientation(source.orientation) || (displayIsLandscape ? 90 : 0),
      deviceFrame,
      frameScale,
      frameRotated,
    };
  }
  const width = evenCeil(display.width);
  const height = evenCeil(display.height);
  return {
    width,
    height,
    screenRect: {
      x: (width - display.width) / 2,
      y: (height - display.height) / 2,
      width: display.width,
      height: display.height,
    },
    rotationDegrees: geometry.rotationDegrees,
    frameRotationDegrees: rotationDegreesForOrientation(source.orientation),
    deviceFrame,
    frameScale: 1,
    frameRotated: false,
  };
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  rect: RecordingRect,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(right - r, rect.y);
  ctx.quadraticCurveTo(right, rect.y, right, rect.y + r);
  ctx.lineTo(right, bottom - r);
  ctx.quadraticCurveTo(right, bottom, right - r, bottom);
  ctx.lineTo(rect.x + r, bottom);
  ctx.quadraticCurveTo(rect.x, bottom, rect.x, bottom - r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  ctx.closePath();
}

function containRect(source: RecordingRect, target: RecordingRect): RecordingRect {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
  };
}

function frameRect(layout: RecordingLayout): RecordingRect | null {
  if (!layout.deviceFrame) return null;
  const frame = DEVICE_FRAMES[layout.deviceFrame];
  const bezelX = layout.frameRotated ? frame.bezelY : frame.bezelX;
  const bezelY = layout.frameRotated ? frame.bezelX : frame.bezelY;
  const width = layout.frameRotated ? frame.height : frame.width;
  const height = layout.frameRotated ? frame.width : frame.height;
  return {
    x: layout.screenRect.x - bezelX * layout.frameScale,
    y: layout.screenRect.y - bezelY * layout.frameScale,
    width: width * layout.frameScale,
    height: height * layout.frameScale,
  };
}

function paintFrameBase(ctx: CanvasRenderingContext2D, layout: RecordingLayout): void {
  const outer = frameRect(layout);
  if (!outer || !layout.deviceFrame) return;
  const frame = DEVICE_FRAMES[layout.deviceFrame];
  ctx.fillStyle = "#09090b";
  roundedRectPath(
    ctx,
    outer,
    (frame.innerRadius + Math.max(frame.bezelX, frame.bezelY)) * layout.frameScale,
  );
  ctx.fill();
}

function iphoneIslandRect(outer: RecordingRect, rotationDegrees: number): RecordingRect {
  const portrait = { x: 151.666, y: 31.667, width: 123.333, height: 36 };
  const portraitWidth = 427;
  const portraitHeight = 881;
  let rotated: RecordingRect;
  let rotatedWidth = portraitWidth;
  let rotatedHeight = portraitHeight;

  if (rotationDegrees === 90) {
    rotated = {
      x: portraitHeight - portrait.y - portrait.height,
      y: portrait.x,
      width: portrait.height,
      height: portrait.width,
    };
    rotatedWidth = portraitHeight;
    rotatedHeight = portraitWidth;
  } else if (rotationDegrees === -90) {
    rotated = {
      x: portrait.y,
      y: portraitWidth - portrait.x - portrait.width,
      width: portrait.height,
      height: portrait.width,
    };
    rotatedWidth = portraitHeight;
    rotatedHeight = portraitWidth;
  } else if (Math.abs(rotationDegrees) === 180) {
    rotated = {
      x: portraitWidth - portrait.x - portrait.width,
      y: portraitHeight - portrait.y - portrait.height,
      width: portrait.width,
      height: portrait.height,
    };
  } else {
    rotated = portrait;
  }

  return {
    x: outer.x + (rotated.x / rotatedWidth) * outer.width,
    y: outer.y + (rotated.y / rotatedHeight) * outer.height,
    width: (rotated.width / rotatedWidth) * outer.width,
    height: (rotated.height / rotatedHeight) * outer.height,
  };
}

function paintFrameChrome(ctx: CanvasRenderingContext2D, layout: RecordingLayout): void {
  const outer = frameRect(layout);
  if (!outer || !layout.deviceFrame) return;
  const frame = DEVICE_FRAMES[layout.deviceFrame];
  ctx.strokeStyle = "#646468";
  ctx.lineWidth = Math.max(1, 1.5 * layout.frameScale);
  roundedRectPath(
    ctx,
    outer,
    (frame.innerRadius + Math.max(frame.bezelX, frame.bezelY)) * layout.frameScale,
  );
  ctx.stroke();

  if (layout.deviceFrame === "iphone") {
    const island = iphoneIslandRect(outer, layout.frameRotationDegrees);
    ctx.fillStyle = "#000";
    roundedRectPath(ctx, island, island.height / 2);
    ctx.fill();
  }
}

function paintTouches(
  ctx: CanvasRenderingContext2D,
  snapshot: RecordingSnapshot,
  contentRect: RecordingRect,
): void {
  const cssScale = Math.max(
    contentRect.width / Math.max(1, snapshot.surfaceWidth),
    contentRect.height / Math.max(1, snapshot.surfaceHeight),
  );
  for (const touch of snapshot.touches) {
    const opacity = Math.max(0, Math.min(1, touch.opacity ?? 1));
    if (opacity === 0) continue;
    const x = contentRect.x + Math.max(0, Math.min(1, touch.x)) * contentRect.width;
    const y = contentRect.y + Math.max(0, Math.min(1, touch.y)) * contentRect.height;
    const radius = (touch.kind === "single" ? 12 : 10) * cssScale;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = touch.kind === "single" ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.45)";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(1, 1.25 * cssScale);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export function paintRecordingFrame(
  ctx: CanvasRenderingContext2D,
  layout: RecordingLayout,
  snapshot: RecordingSnapshot,
): boolean {
  const geometry = streamDisplayGeometry(snapshot);
  const display = geometry.displayConfig;
  if (!display || snapshot.width <= 0 || snapshot.height <= 0) return false;

  ctx.clearRect(0, 0, layout.width, layout.height);
  paintFrameBase(ctx, layout);

  const contentRect = containRect(
    { x: 0, y: 0, width: display.width, height: display.height },
    layout.screenRect,
  );
  ctx.save();
  if (layout.deviceFrame) {
    const frame = DEVICE_FRAMES[layout.deviceFrame];
    roundedRectPath(ctx, layout.screenRect, frame.innerRadius * layout.frameScale);
    ctx.clip();
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(
    layout.screenRect.x,
    layout.screenRect.y,
    layout.screenRect.width,
    layout.screenRect.height,
  );

  ctx.save();
  ctx.translate(
    contentRect.x + contentRect.width / 2,
    contentRect.y + contentRect.height / 2,
  );
  ctx.rotate((geometry.rotationDegrees * Math.PI) / 180);
  const sideways = Math.abs(geometry.rotationDegrees) === 90;
  const drawWidth = sideways ? contentRect.height : contentRect.width;
  const drawHeight = sideways ? contentRect.width : contentRect.height;
  ctx.drawImage(
    snapshot.source,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  ctx.restore();

  paintTouches(ctx, snapshot, contentRect);
  ctx.restore();
  paintFrameChrome(ctx, layout);
  return true;
}

function defaultScreenRecorderPlatform(): ScreenRecorderPlatform {
  return {
    createCanvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    createMediaRecorder(stream, options) {
      return new MediaRecorder(stream as MediaStream, options) as unknown as RecorderMediaRecorder;
    },
    isTypeSupported: (mimeType) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType),
    requestAnimationFrame: (callback) => globalThis.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => globalThis.cancelAnimationFrame(id),
    now: () => performance.now(),
    wallClock: () => Date.now(),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

export class CanvasScreenRecorder {
  private readonly options: CanvasScreenRecorderOptions;
  private readonly platform: ScreenRecorderPlatform;
  private layout: RecordingLayout | null = null;
  private canvas: RecorderCanvas | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private stream: RecorderMediaStream | null = null;
  private mediaRecorder: RecorderMediaRecorder | null = null;
  private chunks: Blob[] = [];
  private rafId: number | null = null;
  private startedAt = 0;
  private startedWallClock = 0;
  private artifactUrl: string | null = null;
  private resolveStop: ((artifact: RecordingArtifact) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private stopPromise: Promise<RecordingArtifact> | null = null;
  private failure: Error | null = null;
  private _state: ScreenRecorderState = "idle";

  constructor(
    options: CanvasScreenRecorderOptions,
    platform: ScreenRecorderPlatform = defaultScreenRecorderPlatform(),
  ) {
    this.options = options;
    this.platform = platform;
  }

  get state(): ScreenRecorderState {
    return this._state;
  }

  start(): void {
    if (this._state !== "idle") throw new Error("screen recorder has already been started");
    const snapshot = this.options.source.snapshot(this.platform.now());
    if (!snapshot) throw new Error("recording source is not ready");
    const format = this.options.format ?? "auto";
    const mimeTypes = supportedRecordingMimeTypes(
      format,
      (candidate) => this.platform.isTypeSupported(candidate),
    );
    if (mimeTypes.length === 0) {
      throw new Error(`no supported ${format.toUpperCase()} recording format`);
    }

    this.layout = createRecordingLayout(snapshot, this.options.deviceFrame ?? null);
    this.canvas = this.platform.createCanvas(this.layout.width, this.layout.height);
    this.context = this.canvas.getContext("2d", { alpha: false });
    if (!this.context) throw new Error("2D canvas is not available");
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";
    if (!this.paint(snapshot)) throw new Error("recording source is not ready");

    this.stream = this.canvas.captureStream(this.options.fps ?? 30);
    let lastFailure: Error | null = null;
    for (const mimeType of mimeTypes) {
      let candidate: RecorderMediaRecorder | null = null;
      try {
        candidate = this.platform.createMediaRecorder(this.stream, {
          mimeType,
          videoBitsPerSecond: this.options.videoBitsPerSecond ?? 8_000_000,
        });
        this.mediaRecorder = candidate;
        candidate.ondataavailable = (event) => {
          if (event.data.size > 0 && this._state !== "cancelled") this.chunks.push(event.data);
        };
        candidate.onstop = () => this.finish();
        candidate.onerror = (event) =>
          this.fail(event.error ?? new Error("screen recording failed"));
        this.startedAt = this.platform.now();
        this.startedWallClock = this.platform.wallClock();
        this._state = "recording";
        candidate.start(1_000);
        break;
      } catch (error) {
        lastFailure = error instanceof Error ? error : new Error(String(error));
        if (candidate) {
          candidate.ondataavailable = null;
          candidate.onstop = null;
          candidate.onerror = null;
          if (candidate.state !== "inactive") {
            try { candidate.stop(); } catch {}
          }
        }
        this.mediaRecorder = null;
        this._state = "idle";
      }
    }
    if (!this.mediaRecorder) {
      const failure = lastFailure ?? new Error(`could not start ${format.toUpperCase()} recording`);
      this.fail(failure);
      throw failure;
    }
    this.schedulePaint();
  }

  stop(): Promise<RecordingArtifact> {
    if (this.stopPromise && (this._state === "stopping" || this._state === "finished")) {
      return this.stopPromise;
    }
    if (this._state === "error" && this.failure) return Promise.reject(this.failure);
    if (this._state !== "recording" || !this.mediaRecorder) {
      return Promise.reject(new Error("screen recorder is not recording"));
    }
    this._state = "stopping";
    this.stopPromise = new Promise<RecordingArtifact>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    try { this.mediaRecorder.requestData?.(); } catch {}
    try {
      this.mediaRecorder.stop();
    } catch (error) {
      this.fail(error);
    }
    return this.stopPromise;
  }

  cancel(): void {
    if (this._state === "cancelled") return;
    const mediaRecorder = this.mediaRecorder;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch {}
    }
    this.releaseActiveResources();
    this.chunks = [];
    if (this.artifactUrl) {
      this.platform.revokeObjectURL(this.artifactUrl);
      this.artifactUrl = null;
    }
    const reject = this.rejectStop;
    this.resolveStop = null;
    this.rejectStop = null;
    this._state = "cancelled";
    reject?.(new Error("screen recording was cancelled"));
  }

  private paint(snapshot: RecordingSnapshot): boolean {
    if (!this.context || !this.layout) return false;
    return paintRecordingFrame(
      this.context,
      this.layout,
      this.options.includeTouches === false && snapshot.touches.length > 0
        ? { ...snapshot, touches: [] }
        : snapshot,
    );
  }

  private schedulePaint(): void {
    this.rafId = this.platform.requestAnimationFrame(() => {
      if (this._state !== "recording" && this._state !== "stopping") return;
      try {
        const snapshot = this.options.source.snapshot(this.platform.now());
        if (snapshot) this.paint(snapshot);
      } catch (error) {
        this.fail(error);
        return;
      }
      this.schedulePaint();
    });
  }

  private finish(): void {
    if (this._state !== "stopping" || !this.layout || !this.mediaRecorder) return;
    let artifact: RecordingArtifact;
    try {
      const endedAt = this.platform.now();
      const mimeType = this.mediaRecorder.mimeType;
      const blob = new Blob(this.chunks, { type: mimeType });
      artifact = {
        blob,
        url: this.platform.createObjectURL(blob),
        filename: recordingFilename(new Date(this.startedWallClock), mimeType),
        mimeType,
        durationSeconds: Math.max(0, endedAt - this.startedAt) / 1_000,
        bytes: blob.size,
        width: this.layout.width,
        height: this.layout.height,
      };
    } catch (error) {
      this.fail(error);
      return;
    }
    this.artifactUrl = artifact.url;
    this.releaseActiveResources();
    this.chunks = [];
    this._state = "finished";
    const resolve = this.resolveStop;
    this.resolveStop = null;
    this.rejectStop = null;
    resolve?.(artifact);
  }

  private fail(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.failure = failure;
    this._state = "error";
    const mediaRecorder = this.mediaRecorder;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch {}
    }
    this.releaseActiveResources();
    this.chunks = [];
    this.options.onError?.(failure);
    const reject = this.rejectStop;
    this.resolveStop = null;
    this.rejectStop = null;
    reject?.(failure);
  }

  private releaseActiveResources(): void {
    if (this.rafId !== null) {
      this.platform.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.mediaRecorder) {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.onerror = null;
    }
    this.stream = null;
    this.mediaRecorder = null;
    this.context = null;
    this.canvas = null;
  }
}
