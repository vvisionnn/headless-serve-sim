import {
  DEVICE_FRAMES,
  rotationDegreesForOrientation,
  streamDisplayGeometry,
  type DeviceFrameSpec,
  type DeviceType,
  type SimulatorRecordingSnapshot,
  type SimulatorRecordingSource,
  type SimulatorRecordingTouch,
  type SimulatorOrientation,
} from "headless-serve-sim-client/simulator";
import type { PreparedDeviceFrameArtwork } from "./device-frame-artwork";

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

export interface RecordingCanvasInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RecordingLayout {
  width: number;
  height: number;
  canvasInsets: RecordingCanvasInsets;
  screenRect: RecordingRect;
  rotationDegrees: number;
  frameRotationDegrees: number;
  frameSpec: DeviceFrameSpec | null;
  frameRect: RecordingRect | null;
  artworkRect: RecordingRect | null;
  frameScale: number;
  screenRadius: number;
  outerRadius: number;
  cutoutRect: RecordingRect | null;
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
  deviceFrame?: DeviceFrameSpec | DeviceType | null;
  deviceFrameArtwork?: PreparedDeviceFrameArtwork | null;
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

interface FrameShadowStyle {
  blur: number;
  offsetY: number;
  color: string;
}

interface FrameDecorationMetrics {
  padding: number;
  shadows: readonly FrameShadowStyle[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function frameDecorationMetrics(frameRect: RecordingRect): FrameDecorationMetrics {
  const shortEdge = Math.min(frameRect.width, frameRect.height);
  return {
    padding: Math.round(clamp(shortEdge * 0.025, 24, 72)),
    shadows: [
      {
        blur: Math.round(clamp(shortEdge * 0.035, 18, 64)),
        offsetY: Math.round(clamp(shortEdge * 0.014, 8, 28)),
        color: "rgba(0,0,0,0.2)",
      },
      {
        blur: Math.round(clamp(shortEdge * 0.012, 6, 20)),
        offsetY: Math.round(clamp(shortEdge * 0.004, 2, 8)),
        color: "rgba(0,0,0,0.14)",
      },
    ],
  };
}

export function createRecordingLayout(
  source: RecordingSourceGeometry,
  deviceFrame: DeviceFrameSpec | DeviceType | null = null,
): RecordingLayout {
  const geometry = streamDisplayGeometry(source);
  const display = geometry.displayConfig;
  if (!display) throw new Error("recording source dimensions must be positive");
  const frameSpec = typeof deviceFrame === "string"
    ? genericDeviceFrameSpec(deviceFrame)
    : deviceFrame;
  if (frameSpec) {
    const native = frameSpec.nativeScreen;
    const insets = frameSpec.insetsPx;
    const chromeWidth = insets.left + native.width + insets.right;
    const chromeHeight = insets.top + native.height + insets.bottom;
    const chromeRect = frameSpec.artwork?.chromeRectPx ?? {
      x: 0,
      y: 0,
      width: chromeWidth,
      height: chromeHeight,
    };
    const boundsWidth = frameSpec.artwork?.width ?? chromeWidth;
    const boundsHeight = frameSpec.artwork?.height ?? chromeHeight;
    const canonicalScreen = {
      x: chromeRect.x + insets.left,
      y: chromeRect.y + insets.top,
      width: native.width,
      height: native.height,
    };
    const outerInsets = frameSpec.outerInsetsPx ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    const canonicalFrame = {
      x: chromeRect.x + outerInsets.left,
      y: chromeRect.y + outerInsets.top,
      width: chromeRect.width - outerInsets.left - outerInsets.right,
      height: chromeRect.height - outerInsets.top - outerInsets.bottom,
    };
    const canonicalArtwork = frameSpec.artwork
      ? { x: 0, y: 0, width: boundsWidth, height: boundsHeight }
      : null;
    const nativeIsLandscape = native.width > native.height;
    const displayIsLandscape = display.width > display.height;
    const frameRotationDegrees = rotationDegreesForOrientation(source.orientation) ||
      (nativeIsLandscape !== displayIsLandscape ? 90 : 0);
    const rotatedScreen = rotateRecordingRect(
      canonicalScreen,
      boundsWidth,
      boundsHeight,
      frameRotationDegrees,
    );
    const rotatedFrame = rotateRecordingRect(
      canonicalFrame,
      boundsWidth,
      boundsHeight,
      frameRotationDegrees,
    );
    const rotatedArtwork = canonicalArtwork
      ? rotateRecordingRect(
          canonicalArtwork,
          boundsWidth,
          boundsHeight,
          frameRotationDegrees,
        )
      : null;
    const frameWidth = Math.abs(frameRotationDegrees) === 90 ? boundsHeight : boundsWidth;
    const frameHeight = Math.abs(frameRotationDegrees) === 90 ? boundsWidth : boundsHeight;
    const frameScale = Math.max(
      display.width / rotatedScreen.width,
      display.height / rotatedScreen.height,
    );
    const scaledFrameWidth = frameWidth * frameScale;
    const scaledFrameHeight = frameHeight * frameScale;
    const undecoratedFrame = {
      x: rotatedFrame.x * frameScale,
      y: rotatedFrame.y * frameScale,
      width: rotatedFrame.width * frameScale,
      height: rotatedFrame.height * frameScale,
    };
    const shadowRect = rotatedArtwork
      ? {
          x: rotatedArtwork.x * frameScale,
          y: rotatedArtwork.y * frameScale,
          width: rotatedArtwork.width * frameScale,
          height: rotatedArtwork.height * frameScale,
        }
      : undecoratedFrame;
    const decoration = frameDecorationMetrics(undecoratedFrame);
    let decoratedLeft = 0;
    let decoratedTop = 0;
    let decoratedRight = scaledFrameWidth;
    let decoratedBottom = scaledFrameHeight;
    for (const shadow of decoration.shadows) {
      decoratedLeft = Math.min(decoratedLeft, shadowRect.x - 2 * shadow.blur);
      decoratedTop = Math.min(
        decoratedTop,
        shadowRect.y + shadow.offsetY - 2 * shadow.blur,
      );
      decoratedRight = Math.max(
        decoratedRight,
        shadowRect.x + shadowRect.width + 2 * shadow.blur,
      );
      decoratedBottom = Math.max(
        decoratedBottom,
        shadowRect.y + shadowRect.height + shadow.offsetY + 2 * shadow.blur,
      );
    }
    const rawWidth = decoratedRight - decoratedLeft + 2 * decoration.padding;
    const rawHeight = decoratedBottom - decoratedTop + 2 * decoration.padding;
    const width = evenCeil(rawWidth);
    const height = evenCeil(rawHeight);
    const offsetX = decoration.padding - decoratedLeft + (width - rawWidth) / 2;
    const offsetY = decoration.padding - decoratedTop + (height - rawHeight) / 2;
    const place = (rect: RecordingRect): RecordingRect => ({
      x: offsetX + rect.x * frameScale,
      y: offsetY + rect.y * frameScale,
      width: rect.width * frameScale,
      height: rect.height * frameScale,
    });
    const canonicalCutout = frameCutoutRect(frameSpec, chromeRect.x, chromeRect.y);
    const cutoutRect = canonicalCutout
      ? place(rotateRecordingRect(
          canonicalCutout,
          boundsWidth,
          boundsHeight,
          frameRotationDegrees,
        ))
      : null;
    return {
      width,
      height,
      canvasInsets: {
        top: offsetY,
        right: width - offsetX - scaledFrameWidth,
        bottom: height - offsetY - scaledFrameHeight,
        left: offsetX,
      },
      screenRect: place(rotatedScreen),
      rotationDegrees: geometry.rotationDegrees,
      frameRotationDegrees,
      frameSpec,
      frameRect: place(rotatedFrame),
      artworkRect: rotatedArtwork ? place(rotatedArtwork) : null,
      frameScale,
      screenRadius: Math.max(...Object.values(frameSpec.screenRadiiPx)) * frameScale,
      outerRadius: Math.max(frameSpec.outerRadiiPx.x, frameSpec.outerRadiiPx.y) * frameScale,
      cutoutRect,
    };
  }
  const width = evenCeil(display.width);
  const height = evenCeil(display.height);
  return {
    width,
    height,
    canvasInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    screenRect: {
      x: (width - display.width) / 2,
      y: (height - display.height) / 2,
      width: display.width,
      height: display.height,
    },
    rotationDegrees: geometry.rotationDegrees,
    frameRotationDegrees: rotationDegreesForOrientation(source.orientation),
    frameSpec: null,
    frameRect: null,
    artworkRect: null,
    frameScale: 1,
    screenRadius: 0,
    outerRadius: 0,
    cutoutRect: null,
  };
}

function preparedArtworkMatchesFrame(
  frame: DeviceFrameSpec,
  artwork: PreparedDeviceFrameArtwork | null,
): artwork is PreparedDeviceFrameArtwork {
  return Boolean(
    artwork && frame.artwork &&
    artwork.deviceTypeIdentifier === frame.deviceTypeIdentifier &&
    artwork.chromeIdentifier === frame.chromeIdentifier &&
    artwork.width === frame.artwork.width &&
    artwork.height === frame.artwork.height,
  );
}

export function effectiveRecordingDeviceFrame(
  deviceFrame: DeviceFrameSpec | DeviceType | null,
  artwork: PreparedDeviceFrameArtwork | null,
): DeviceFrameSpec | DeviceType | null {
  if (typeof deviceFrame !== "object" || !deviceFrame?.artwork) return deviceFrame;
  return preparedArtworkMatchesFrame(deviceFrame, artwork)
    ? deviceFrame
    : { ...deviceFrame, artwork: undefined };
}

function genericDeviceFrameSpec(deviceType: DeviceType): DeviceFrameSpec | null {
  if (deviceType === "vision") return null;
  const frame = DEVICE_FRAMES[deviceType];
  const screenWidth = frame.width - 2 * frame.bezelX;
  const screenHeight = frame.height - 2 * frame.bezelY;
  return {
    deviceTypeIdentifier: `generic:${deviceType}`,
    modelName: `Generic ${deviceType}`,
    family: deviceType,
    nativeScreen: { width: screenWidth, height: screenHeight },
    insetsPx: {
      top: frame.bezelY,
      right: frame.bezelX,
      bottom: frame.bezelY,
      left: frame.bezelX,
    },
    screenRadiiPx: {
      topLeft: frame.innerRadius,
      topRight: frame.innerRadius,
      bottomRight: frame.innerRadius,
      bottomLeft: frame.innerRadius,
    },
    outerRadiiPx: {
      x: frame.innerRadius + frame.bezelX,
      y: frame.innerRadius + frame.bezelY,
    },
    cutout: deviceType === "iphone" ? "dynamic-island" : "none",
    chromeIdentifier: `generic:${deviceType}`,
  };
}

function rotateRecordingRect(
  rect: RecordingRect,
  boundsWidth: number,
  boundsHeight: number,
  rotationDegrees: number,
): RecordingRect {
  if (rotationDegrees === 90) {
    return {
      x: boundsHeight - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }
  if (rotationDegrees === -90) {
    return {
      x: rect.y,
      y: boundsWidth - rect.x - rect.width,
      width: rect.height,
      height: rect.width,
    };
  }
  if (Math.abs(rotationDegrees) === 180) {
    return {
      x: boundsWidth - rect.x - rect.width,
      y: boundsHeight - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    };
  }
  return rect;
}

function frameCutoutRect(
  frame: DeviceFrameSpec,
  offsetX = 0,
  offsetY = 0,
): RecordingRect | null {
  if (frame.cutout === "none") return null;
  const screen = frame.nativeScreen;
  if (frame.cutoutRectPx) {
    return {
      x: offsetX + frame.insetsPx.left + frame.cutoutRectPx.x,
      y: offsetY + frame.insetsPx.top + frame.cutoutRectPx.y,
      width: frame.cutoutRectPx.width,
      height: frame.cutoutRectPx.height,
    };
  }
  const width = screen.width * (frame.cutout === "dynamic-island" ? 123.333 / 391 : 209 / 390);
  const height = screen.height * (frame.cutout === "dynamic-island" ? 36 / 845 : 32 / 844);
  return {
    x: offsetX + frame.insetsPx.left + (screen.width - width) / 2,
    y: offsetY + frame.insetsPx.top +
      (frame.cutout === "dynamic-island" ? screen.height * (13.667 / 845) : 0),
    width,
    height,
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
  ctx.arcTo(right, rect.y, right, rect.y + r, r);
  ctx.lineTo(right, bottom - r);
  ctx.arcTo(right, bottom, right - r, bottom, r);
  ctx.lineTo(rect.x + r, bottom);
  ctx.arcTo(rect.x, bottom, rect.x, bottom - r, r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.arcTo(rect.x, rect.y, rect.x + r, rect.y, r);
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

function recordingBackground(layout: RecordingLayout): string {
  return layout.frameSpec ? "#f5f5f7" : "#000";
}

function paintFrameBase(
  ctx: CanvasRenderingContext2D,
  layout: RecordingLayout,
  shadowScale: number,
  artwork: PreparedDeviceFrameArtwork | null,
): void {
  const outer = layout.frameRect;
  if (!outer || !layout.frameSpec) return;
  const decoration = frameDecorationMetrics(outer);
  for (const shadow of decoration.shadows) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur * shadowScale;
    ctx.shadowOffsetY = shadow.offsetY * shadowScale;
    if (artwork && layout.artworkRect) {
      const shift = layout.width + layout.artworkRect.width + 4 * shadow.blur;
      ctx.shadowOffsetX = shift * shadowScale;
      paintPreparedArtwork(ctx, layout, artwork, -shift);
    } else {
      ctx.fillStyle = "#09090b";
      ctx.shadowOffsetX = 0;
      roundedRectPath(ctx, outer, layout.outerRadius);
      ctx.fill();
    }
    ctx.restore();
  }
  if (!artwork) {
    ctx.fillStyle = "#09090b";
    roundedRectPath(ctx, outer, layout.outerRadius);
    ctx.fill();
  }
}

function paintFrameChrome(
  ctx: CanvasRenderingContext2D,
  layout: RecordingLayout,
  hasArtwork: boolean,
): void {
  const outer = layout.frameRect;
  if (!outer || !layout.frameSpec) return;
  if (!hasArtwork) {
    ctx.strokeStyle = "#646468";
    ctx.lineWidth = Math.max(1, 1.5 * layout.frameScale);
    roundedRectPath(ctx, outer, layout.outerRadius);
    ctx.stroke();
  }

  if (layout.cutoutRect) {
    ctx.fillStyle = "#000";
    roundedRectPath(ctx, layout.cutoutRect, layout.cutoutRect.height / 2);
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
  artwork: PreparedDeviceFrameArtwork | null = null,
): boolean {
  return paintRecordingFrameAtScale(ctx, layout, snapshot, 1, artwork);
}

function compatibleArtwork(
  layout: RecordingLayout,
  artwork: PreparedDeviceFrameArtwork | null,
): artwork is PreparedDeviceFrameArtwork {
  const spec = layout.frameSpec;
  return Boolean(
    artwork && spec?.artwork && layout.artworkRect &&
    preparedArtworkMatchesFrame(spec, artwork),
  );
}

function paintPreparedArtwork(
  ctx: CanvasRenderingContext2D,
  layout: RecordingLayout,
  artwork: PreparedDeviceFrameArtwork,
  offsetX = 0,
): void {
  const original = layout.artworkRect!;
  const rect = { ...original, x: original.x + offsetX };
  const rotation = layout.frameRotationDegrees;
  if (rotation === 0) {
    ctx.drawImage(artwork.source, rect.x, rect.y, rect.width, rect.height);
    return;
  }
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const sideways = Math.abs(rotation) === 90;
  const width = sideways ? rect.height : rect.width;
  const height = sideways ? rect.width : rect.height;
  ctx.drawImage(artwork.source, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function paintRecordingFrameAtScale(
  ctx: CanvasRenderingContext2D,
  layout: RecordingLayout,
  snapshot: RecordingSnapshot,
  shadowScale: number,
  artwork: PreparedDeviceFrameArtwork | null,
): boolean {
  const geometry = streamDisplayGeometry(snapshot);
  const display = geometry.displayConfig;
  if (!display || snapshot.width <= 0 || snapshot.height <= 0) return false;

  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = recordingBackground(layout);
  ctx.fillRect(0, 0, layout.width, layout.height);
  const hasArtwork = compatibleArtwork(layout, artwork);
  paintFrameBase(ctx, layout, shadowScale, hasArtwork ? artwork : null);
  if (hasArtwork) paintPreparedArtwork(ctx, layout, artwork);

  const contentRect = containRect(
    { x: 0, y: 0, width: display.width, height: display.height },
    layout.screenRect,
  );
  ctx.save();
  if (layout.frameSpec) {
    roundedRectPath(ctx, layout.screenRect, layout.screenRadius);
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
  paintFrameChrome(ctx, layout, hasArtwork);
  return true;
}

export function paintRecordingSnapshot(
  ctx: CanvasRenderingContext2D,
  canvasLayout: RecordingLayout,
  deviceFrame: DeviceFrameSpec | DeviceType | null,
  snapshot: RecordingSnapshot,
  artwork: PreparedDeviceFrameArtwork | null = null,
): boolean {
  const frameLayout = createRecordingLayout(snapshot, deviceFrame);
  const target = containRect(
    { x: 0, y: 0, width: frameLayout.width, height: frameLayout.height },
    { x: 0, y: 0, width: canvasLayout.width, height: canvasLayout.height },
  );
  const scale = target.width / frameLayout.width;

  ctx.save();
  ctx.fillStyle = recordingBackground(canvasLayout);
  ctx.fillRect(0, 0, canvasLayout.width, canvasLayout.height);
  ctx.translate(target.x, target.y);
  ctx.scale(scale, scale);
  const painted = paintRecordingFrameAtScale(ctx, frameLayout, snapshot, scale, artwork);
  ctx.restore();
  return painted;
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

    this.layout = createRecordingLayout(
      snapshot,
      effectiveRecordingDeviceFrame(
        this.options.deviceFrame ?? null,
        this.options.deviceFrameArtwork ?? null,
      ),
    );
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
    return paintRecordingSnapshot(
      this.context,
      this.layout,
      effectiveRecordingDeviceFrame(
        this.options.deviceFrame ?? null,
        this.options.deviceFrameArtwork ?? null,
      ),
      this.options.includeTouches === false && snapshot.touches.length > 0
        ? { ...snapshot, touches: [] }
        : snapshot,
      this.options.deviceFrameArtwork ?? null,
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
