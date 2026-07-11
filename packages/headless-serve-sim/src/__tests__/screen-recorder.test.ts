import { describe, expect, test } from "bun:test";
import {
  CanvasScreenRecorder,
  createRecordingLayout,
  effectiveRecordingDeviceFrame,
  paintRecordingFrame,
  paintRecordingSnapshot,
  recordingExtension,
  selectRecordingMimeType,
  type RecorderCanvas,
  type RecorderMediaRecorder,
  type RecorderMediaStream,
  type ScreenRecorderPlatform,
} from "../client/screen-recorder";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import type { PreparedDeviceFrameArtwork } from "../client/device-frame-artwork";

const IPHONE_17_PRO_FRAME: DeviceFrameSpec = {
  deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  modelName: "iPhone 17 Pro",
  family: "iphone",
  nativeScreen: { width: 1206, height: 2622 },
  insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
  screenRadiiPx: { topLeft: 186, topRight: 186, bottomRight: 186, bottomLeft: 186 },
  outerRadiiPx: { x: 240, y: 240 },
  cutout: "dynamic-island",
  chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
};

const IPHONE_16E_FRAME: DeviceFrameSpec = {
  deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16e",
  modelName: "iPhone 16e",
  family: "iphone",
  nativeScreen: { width: 1170, height: 2532 },
  insetsPx: { top: 66, right: 66, bottom: 66, left: 66 },
  screenRadiiPx: { topLeft: 142, topRight: 142, bottomRight: 142, bottomLeft: 142 },
  outerRadiiPx: { x: 204, y: 204 },
  cutout: "notch",
  cutoutRectPx: { x: 321, y: 0, width: 528, height: 102 },
  chromeIdentifier: "com.apple.dt.devicekit.chrome.phone13",
};

const REAL_IPHONE_17_PRO_FRAME: DeviceFrameSpec = {
  ...IPHONE_17_PRO_FRAME,
  artwork: {
    width: 1368,
    height: 2730,
    chromeRectPx: { x: 27, y: 0, width: 1314, height: 2730 },
    slices: {
      topLeft: { pngDataUrl: "tl", width: 330, height: 330 },
      top: { pngDataUrl: "top", width: 3, height: 330 },
      topRight: { pngDataUrl: "tr", width: 330, height: 330 },
      right: { pngDataUrl: "right", width: 330, height: 3 },
      bottomRight: { pngDataUrl: "br", width: 330, height: 330 },
      bottom: { pngDataUrl: "bottom", width: 3, height: 330 },
      bottomLeft: { pngDataUrl: "bl", width: 330, height: 330 },
      left: { pngDataUrl: "left", width: 330, height: 3 },
    },
    controls: [{
      name: "power",
      image: { pngDataUrl: "power", width: 48, height: 303 },
      onTop: false,
      anchor: "right",
      align: "leading",
      normalOffsetPx: { x: -24, y: 786 },
      rolloverOffsetPx: { x: -9, y: 786 },
    }],
  },
};

const REAL_IPHONE_17_PRO_ARTWORK: PreparedDeviceFrameArtwork = {
  source: { id: "real-frame" } as unknown as CanvasImageSource,
  width: 1368,
  height: 2730,
  deviceTypeIdentifier: REAL_IPHONE_17_PRO_FRAME.deviceTypeIdentifier,
  chromeIdentifier: REAL_IPHONE_17_PRO_FRAME.chromeIdentifier,
};

interface RecordingContextState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

class RecordingContext {
  calls: Array<{ name: string; args: unknown[]; state: RecordingContextState }> = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  globalAlpha = 1;
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  drawImageError: Error | null = null;
  private readonly savedStates: RecordingContextState[] = [];

  private state(): RecordingContextState {
    return {
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY,
    };
  }

  private call(name: string, ...args: unknown[]) {
    this.calls.push({ name, args, state: this.state() });
  }

  save() {
    this.call("save");
    this.savedStates.push(this.state());
  }
  restore() {
    this.call("restore");
    const state = this.savedStates.pop();
    if (state) Object.assign(this, state);
  }
  clearRect(...args: number[]) { this.call("clearRect", ...args); }
  fillRect(...args: number[]) { this.call("fillRect", ...args); }
  beginPath() { this.call("beginPath"); }
  moveTo(...args: number[]) { this.call("moveTo", ...args); }
  lineTo(...args: number[]) { this.call("lineTo", ...args); }
  quadraticCurveTo(...args: number[]) { this.call("quadraticCurveTo", ...args); }
  arcTo(...args: number[]) { this.call("arcTo", ...args); }
  closePath() { this.call("closePath"); }
  clip() { this.call("clip"); }
  fill() { this.call("fill"); }
  stroke() { this.call("stroke"); }
  arc(...args: number[]) { this.call("arc", ...args); }
  translate(...args: number[]) { this.call("translate", ...args); }
  rotate(...args: number[]) { this.call("rotate", ...args); }
  scale(...args: number[]) { this.call("scale", ...args); }
  drawImage(...args: unknown[]) {
    if (this.drawImageError) throw this.drawImageError;
    this.call("drawImage", ...args);
  }
}

class FakeMediaRecorder implements RecorderMediaRecorder {
  mimeType = "video/mp4";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error?: unknown }) => void) | null = null;
  starts: number[] = [];
  requests = 0;
  stops = 0;

  start(timeslice?: number) {
    this.state = "recording";
    this.starts.push(timeslice ?? 0);
  }

  requestData() {
    this.requests++;
  }

  stop() {
    this.stops++;
    this.state = "inactive";
  }

  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) });
  }

  finish() {
    this.onstop?.();
  }

  fail(error: Error) {
    this.onerror?.({ error });
  }
}

class FakeRecorderPlatform implements ScreenRecorderPlatform {
  readonly context = new RecordingContext();
  readonly recorder = new FakeMediaRecorder();
  readonly track = { stops: 0, stop: () => { this.track.stops++; } };
  readonly stream: RecorderMediaStream = { getTracks: () => [this.track] };
  readonly captureFrameRates: number[] = [];
  readonly canvas: RecorderCanvas = {
    width: 0,
    height: 0,
    getContext: () => this.context as unknown as CanvasRenderingContext2D,
    captureStream: (frameRate) => {
      this.captureFrameRates.push(frameRate);
      return this.stream;
    },
  };
  nowMs = 1_000;
  wallClockMs = Date.UTC(2026, 6, 11, 12, 34, 56);
  nextRaf = 1;
  rafCallbacks = new Map<number, FrameRequestCallback>();
  cancelledRafs: number[] = [];
  revokedUrls: string[] = [];

  createCanvas(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    return this.canvas;
  }

  createMediaRecorder(_stream: RecorderMediaStream, options: MediaRecorderOptions) {
    this.recorder.mimeType = options.mimeType ?? "video/webm";
    return this.recorder;
  }

  isTypeSupported(mimeType: string): boolean {
    return mimeType === "video/mp4";
  }

  requestAnimationFrame(callback: FrameRequestCallback) {
    const id = this.nextRaf++;
    this.rafCallbacks.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number) {
    this.cancelledRafs.push(id);
    this.rafCallbacks.delete(id);
  }

  now() { return this.nowMs; }
  wallClock() { return this.wallClockMs; }
  createObjectURL(): string { return "blob:recording-1"; }
  revokeObjectURL(url: string) { this.revokedUrls.push(url); }
}

describe("screen recording format selection", () => {
  test("auto prefers a supported MP4 container", () => {
    const supported = new Set(["video/mp4", "video/webm;codecs=vp9"]);

    expect(selectRecordingMimeType("auto", (mime) => supported.has(mime))).toBe("video/mp4");
  });

  test("an explicit WebM request never falls back to MP4", () => {
    const supported = new Set(["video/mp4", "video/webm;codecs=vp8"]);

    expect(selectRecordingMimeType("webm", (mime) => supported.has(mime))).toBe(
      "video/webm;codecs=vp8",
    );
  });

  test("the downloaded extension follows the recorder's actual MIME type", () => {
    expect(recordingExtension("video/mp4;codecs=avc1.640034")).toBe("mp4");
    expect(recordingExtension("video/webm;codecs=vp9")).toBe("webm");
  });
});

describe("screen recording layout", () => {
  test("adds visible padding beyond the complete framed-video shadow", () => {
    const layout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, IPHONE_17_PRO_FRAME);

    expect(layout.canvasInsets).toEqual({
      top: 107,
      right: 125,
      bottom: 143,
      left: 125,
    });
    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 1564,
      height: 2980,
    });
    expect(layout.frameRect).toEqual({
      x: 125,
      y: 107,
      width: 1314,
      height: 2730,
    });

    const ambientBlur = 46;
    const ambientOffsetY = 18;
    const visiblePadding = 33;
    expect(layout.frameRect!.x - 2 * ambientBlur).toBe(visiblePadding);
    expect(layout.frameRect!.y + ambientOffsetY - 2 * ambientBlur).toBe(visiblePadding);
    expect(
      layout.width - (layout.frameRect!.x + layout.frameRect!.width + 2 * ambientBlur),
    ).toBe(visiblePadding);
    expect(
      layout.height -
        (layout.frameRect!.y + layout.frameRect!.height + ambientOffsetY + 2 * ambientBlur),
    ).toBe(visiblePadding);
  });

  test("uses the exact iPhone 17 Pro profile without scaling the screen", () => {
    const layout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, IPHONE_17_PRO_FRAME);

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 1564,
      height: 2980,
    });
    expect(layout.screenRect).toEqual({
      x: 179,
      y: 161,
      width: 1206,
      height: 2622,
    });
  });

  test("includes DeviceKit artwork padding and hardware controls in the canvas", () => {
    const layout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, REAL_IPHONE_17_PRO_FRAME);

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 1618,
      height: 2980,
    });
    expect(layout.canvasInsets).toEqual({
      top: 107,
      right: 125,
      bottom: 143,
      left: 125,
    });
    expect(layout.artworkRect).toEqual({
      x: 125,
      y: 107,
      width: 1368,
      height: 2730,
    });
    expect(layout.frameRect).toEqual({
      x: 152,
      y: 107,
      width: 1314,
      height: 2730,
    });
    expect(layout.screenRect).toEqual({
      x: 206,
      y: 161,
      width: 1206,
      height: 2622,
    });
  });

  test("rotates the complete metal frame and controls as one physical device", () => {
    const layout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "landscape_left",
    }, REAL_IPHONE_17_PRO_FRAME);

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 2980,
      height: 1618,
    });
    expect(layout.artworkRect).toEqual({
      x: 125,
      y: 107,
      width: 2730,
      height: 1368,
    });
    expect(layout.frameRotationDegrees).toBe(90);
  });

  test("falls back to procedural chrome if exact artwork could not be prepared", () => {
    const withoutArtwork = effectiveRecordingDeviceFrame(
      REAL_IPHONE_17_PRO_FRAME,
      null,
    );
    const withArtwork = effectiveRecordingDeviceFrame(
      REAL_IPHONE_17_PRO_FRAME,
      REAL_IPHONE_17_PRO_ARTWORK,
    );

    expect(createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, withoutArtwork).width).toBe(1564);
    expect(createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, withArtwork).width).toBe(1618);
  });

  test("rotates exact frame insets and cutout with the simulator", () => {
    const layout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "landscape_left",
    }, IPHONE_17_PRO_FRAME);

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 2980,
      height: 1564,
    });
    expect(layout.screenRect).toEqual({
      x: 179,
      y: 161,
      width: 2622,
      height: 1206,
    });
    expect(layout.cutoutRect!.x).toBeGreaterThan(
      layout.screenRect.x + layout.screenRect.width * 0.9,
    );
  });

  test("uses a wide notch for iPhone 16e instead of a Dynamic Island", () => {
    const notch = createRecordingLayout({
      width: 1170,
      height: 2532,
      orientation: "portrait",
    }, IPHONE_16E_FRAME);
    const island = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, IPHONE_17_PRO_FRAME);

    expect(notch.cutoutRect!.width).toBe(528);
    expect(island.cutoutRect!.width / island.screenRect.width).toBeLessThan(0.4);
  });

  test("honors DeviceKit outside-border insets for Watch crown padding", () => {
    const watch: DeviceFrameSpec = {
      deviceTypeIdentifier: "watch-ultra",
      modelName: "Apple Watch Ultra",
      family: "watch",
      nativeScreen: { width: 410, height: 502 },
      insetsPx: { top: 62, right: 91, bottom: 62, left: 91 },
      screenRadiiPx: { topLeft: 88, topRight: 88, bottomRight: 88, bottomLeft: 88 },
      outerRadiiPx: { x: 170.4, y: 170.4 },
      outerInsetsPx: { top: 0, right: 29, bottom: 0, left: 29 },
      cutout: "none",
      chromeIdentifier: "com.apple.dt.devicekit.chrome.watch4",
    };
    const layout = createRecordingLayout({
      width: 410,
      height: 502,
      orientation: "portrait",
    }, watch);

    expect(layout.canvasInsets).toEqual({ top: 54, right: 33, bottom: 70, left: 33 });
    expect(layout.frameRect).toEqual({ x: 62, y: 54, width: 534, height: 626 });
    expect(layout.frameRect!.x - 2 * 19).toBe(24);
    expect(layout.frameRect!.y + 8 - 2 * 19).toBe(24);
    expect(layout.width - layout.frameRect!.x - layout.frameRect!.width - 2 * 19).toBe(24);
    expect(layout.height - layout.frameRect!.y - layout.frameRect!.height - 8 - 2 * 19).toBe(24);
  });

  test("keeps every rotated frame shadow inside the padded canvas", () => {
    for (const orientation of [
      "portrait",
      "landscape_left",
      "landscape_right",
      "portrait_upside_down",
    ] as const) {
      const layout = createRecordingLayout({
        width: 1206,
        height: 2622,
        orientation,
      }, IPHONE_17_PRO_FRAME);
      const frame = layout.frameRect!;
      const ambientBlur = 46;
      const ambientOffsetY = 18;

      expect(frame.x - 2 * ambientBlur).toBeGreaterThanOrEqual(33);
      expect(frame.y + ambientOffsetY - 2 * ambientBlur).toBeGreaterThanOrEqual(33);
      expect(layout.width - frame.x - frame.width - 2 * ambientBlur).toBeGreaterThanOrEqual(33);
      expect(
        layout.height - frame.y - frame.height - ambientOffsetY - 2 * ambientBlur,
      ).toBeGreaterThanOrEqual(33);
    }
  });

  test("rounds odd source dimensions up to encoder-safe even dimensions", () => {
    const layout = createRecordingLayout({
      width: 1179,
      height: 2556,
      orientation: "portrait",
    });

    expect(layout.width).toBe(1180);
    expect(layout.height).toBe(2556);
    expect(layout.screenRect).toEqual({ x: 0.5, y: 0, width: 1179, height: 2556 });
  });

  test("uses display orientation when raw frames remain portrait", () => {
    const layout = createRecordingLayout({
      width: 1179,
      height: 2556,
      orientation: "landscape_left",
    });

    expect(layout.rotationDegrees).toBe(90);
    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 2556,
      height: 1180,
    });
  });

  test("adds the selected generic device frame around the screen", () => {
    const layout = createRecordingLayout(
      { width: 391, height: 845, orientation: "portrait" },
      "iphone",
    );

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 548,
      height: 1002,
    });
    expect(layout.screenRect).toEqual({
      x: 78.5,
      y: 70.5,
      width: 391,
      height: 845,
    });
  });

  test("produces valid even-sized layouts for supported generic frame families", () => {
    for (const deviceFrame of ["iphone", "ipad", "watch"] as const) {
      const layout = createRecordingLayout(
        { width: 400, height: 800, orientation: "portrait" },
        deviceFrame,
      );
      expect(layout.width % 2).toBe(0);
      expect(layout.height % 2).toBe(0);
      expect(layout.screenRect.width).toBeGreaterThanOrEqual(400);
      expect(layout.screenRect.height).toBeGreaterThanOrEqual(800);
      expect(layout.frameSpec?.family).toBe(deviceFrame);
    }
  });

  test("does not invent physical chrome for Vision without an installed profile", () => {
    const layout = createRecordingLayout(
      { width: 1920, height: 1080, orientation: "landscape_left" },
      "vision",
    );
    expect(layout.frameSpec).toBeNull();
    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  test("rotates portrait frame geometry around a landscape screen", () => {
    const layout = createRecordingLayout(
      { width: 845, height: 391, orientation: "landscape_left" },
      "iphone",
    );

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 1002,
      height: 548,
    });
    expect(layout.screenRect).toEqual({
      x: 78.5,
      y: 70.5,
      width: 845,
      height: 391,
    });
  });
});

describe("screen recording composition", () => {
  test("uses real artwork alpha for shadows and paints the frame before the screen", () => {
    const frameSource = { id: "real-frame" } as unknown as CanvasImageSource;
    const screenSource = { id: "screen" } as unknown as CanvasImageSource;
    const prepared: PreparedDeviceFrameArtwork = {
      ...REAL_IPHONE_17_PRO_ARTWORK,
      source: frameSource,
    };
    const snapshot = {
      source: screenSource,
      width: 1206,
      height: 2622,
      orientation: "portrait" as const,
      surfaceWidth: 1206,
      surfaceHeight: 2622,
      touches: [],
    };
    const layout = createRecordingLayout(snapshot, REAL_IPHONE_17_PRO_FRAME);
    const context = new RecordingContext();

    expect(paintRecordingFrame(
      context as unknown as CanvasRenderingContext2D,
      layout,
      snapshot,
      prepared,
    )).toBe(true);

    const draws = context.calls.filter((call) => call.name === "drawImage");
    expect(draws.map((draw) => draw.args[0])).toEqual([
      frameSource,
      frameSource,
      frameSource,
      screenSource,
    ]);
    expect(draws.slice(0, 2).map((draw) => draw.state.shadowBlur)).toEqual([46, 16]);
    expect(draws[2]!.state.shadowBlur).toBe(0);
    expect(draws[2]!.args.slice(-4)).toEqual([125, 107, 1368, 2730]);
    expect(context.calls.filter((call) => call.name === "stroke")).toHaveLength(0);
    expect(context.calls.filter((call) => call.name === "arcTo").length).toBeGreaterThan(0);
    expect(context.calls.filter((call) => call.name === "quadraticCurveTo")).toHaveLength(0);
  });

  test("paints a macOS-style framed shadow without leaking it onto video content", () => {
    const ctx = new RecordingContext();
    const snapshot = {
      source: {} as CanvasImageSource,
      width: 1206,
      height: 2622,
      orientation: "portrait" as const,
      surfaceWidth: 1206,
      surfaceHeight: 2622,
      touches: [],
    };
    const layout = createRecordingLayout(snapshot, IPHONE_17_PRO_FRAME);

    paintRecordingFrame(
      ctx as unknown as CanvasRenderingContext2D,
      layout,
      snapshot,
    );

    const background = ctx.calls.find((call) =>
      call.name === "fillRect" &&
      call.args[0] === 0 &&
      call.args[1] === 0 &&
      call.args[2] === layout.width &&
      call.args[3] === layout.height
    );
    expect(background?.state.fillStyle).toBe("#f5f5f7");

    const shadowFills = ctx.calls.filter((call) =>
      call.name === "fill" && call.state.shadowBlur > 0
    );
    expect(shadowFills.map((call) => ({
      color: call.state.shadowColor,
      blur: call.state.shadowBlur,
      offsetX: call.state.shadowOffsetX,
      offsetY: call.state.shadowOffsetY,
    }))).toEqual([
      { color: "rgba(0,0,0,0.2)", blur: 46, offsetX: 0, offsetY: 18 },
      { color: "rgba(0,0,0,0.14)", blur: 16, offsetX: 0, offsetY: 5 },
    ]);

    const draw = ctx.calls.find((call) => call.name === "drawImage");
    const drawIndex = ctx.calls.indexOf(draw!);
    const solidFrameFill = ctx.calls.find((call) =>
      call.name === "fill" && call.state.shadowBlur === 0
    );
    expect(shadowFills.every((call) => ctx.calls.indexOf(call) < drawIndex)).toBe(true);
    expect(ctx.calls.indexOf(solidFrameFill!)).toBeLessThan(drawIndex);
    expect(draw?.state.shadowBlur).toBe(0);
    expect(draw?.state.shadowOffsetY).toBe(0);
  });

  test("paints the screen, then touch indicators, then frame chrome", () => {
    const source = { id: "screen" } as unknown as CanvasImageSource;
    const layout = createRecordingLayout(
      { width: 391, height: 845, orientation: "portrait" },
      "iphone",
    );
    const ctx = new RecordingContext();

    const painted = paintRecordingFrame(
      ctx as unknown as CanvasRenderingContext2D,
      layout,
      {
        source,
        width: 391,
        height: 845,
        orientation: "portrait",
        surfaceWidth: 320,
        surfaceHeight: 692,
        touches: [{ x: 0.25, y: 0.75, kind: "single", opacity: 1 }],
      },
    );

    expect(painted).toBe(true);
    expect(
      ctx.calls
        .map((call) => call.name)
        .filter((name) => name === "drawImage" || name === "arc" || name === "stroke"),
    ).toEqual(["drawImage", "arc", "stroke", "stroke"]);
  });

  test("keeps frameless dimensions, black background, and shadow-free rendering", () => {
    const ctx = new RecordingContext();
    const snapshot = {
      source: {} as CanvasImageSource,
      width: 100,
      height: 200,
      orientation: "portrait" as const,
      surfaceWidth: 100,
      surfaceHeight: 200,
      touches: [],
    };
    const layout = createRecordingLayout(snapshot);

    paintRecordingFrame(ctx as unknown as CanvasRenderingContext2D, layout, snapshot);

    expect({ width: layout.width, height: layout.height }).toEqual({ width: 100, height: 200 });
    expect(layout.canvasInsets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(ctx.calls.find((call) =>
      call.name === "fillRect" &&
      call.args[0] === 0 &&
      call.args[1] === 0 &&
      call.args[2] === layout.width &&
      call.args[3] === layout.height
    )?.state.fillStyle).toBe("#000");
    expect(ctx.calls.filter((call) => call.state.shadowBlur > 0)).toHaveLength(0);
  });

  test("applies every requested orientation before drawing the source", () => {
    const cases = [
      ["portrait", 0],
      ["landscape_left", Math.PI / 2],
      ["landscape_right", -Math.PI / 2],
      ["portrait_upside_down", Math.PI],
    ] as const;

    for (const [orientation, expectedRadians] of cases) {
      const ctx = new RecordingContext();
      const snapshot = {
        source: {} as CanvasImageSource,
        width: 100,
        height: 200,
        orientation,
        surfaceWidth: 100,
        surfaceHeight: 200,
        touches: [],
      };
      paintRecordingFrame(
        ctx as unknown as CanvasRenderingContext2D,
        createRecordingLayout(snapshot),
        snapshot,
      );

      expect(ctx.calls.find((call) => call.name === "rotate")?.args[0]).toBeCloseTo(
        expectedRadians,
      );
    }
  });

  test("recomposes the full landscape device inside a fixed portrait recording canvas", () => {
    const ctx = new RecordingContext();
    const layout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, IPHONE_17_PRO_FRAME);

    paintRecordingSnapshot(
      ctx as unknown as CanvasRenderingContext2D,
      layout,
      IPHONE_17_PRO_FRAME,
      {
      source: {} as CanvasImageSource,
      width: 2622,
      height: 1206,
      orientation: "landscape_left",
      surfaceWidth: 2622,
      surfaceHeight: 1206,
      touches: [],
      },
    );

    const scale = ctx.calls.find((call) => call.name === "scale")?.args[0] as number;
    const translate = ctx.calls.find((call) => call.name === "translate")?.args;
    expect(scale).toBeCloseTo(1564 / 2980);
    expect(translate?.[0]).toBeCloseTo(0);
    expect(translate?.[1] as number).toBeGreaterThan(1_000);
    expect(ctx.calls.filter((call) => call.name === "clearRect").map((call) => call.args)).toContainEqual([
      0,
      0,
      2980,
      1564,
    ]);
    const scaledShadows = ctx.calls.filter((call) =>
      call.name === "fill" && call.state.shadowBlur > 0
    );
    expect(scaledShadows[0]?.state.shadowBlur).toBeCloseTo(46 * scale);
    expect(scaledShadows[0]?.state.shadowOffsetY).toBeCloseTo(18 * scale);
    expect(ctx.calls.find((call) =>
      call.name === "fillRect" &&
      call.args[2] === layout.width &&
      call.args[3] === layout.height
    )?.state.fillStyle).toBe("#f5f5f7");
  });

  test("keeps alpha-shaped artwork shadows aligned after a fixed-canvas rotation", () => {
    const context = new RecordingContext();
    const canvasLayout = createRecordingLayout({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    }, REAL_IPHONE_17_PRO_FRAME);

    paintRecordingSnapshot(
      context as unknown as CanvasRenderingContext2D,
      canvasLayout,
      REAL_IPHONE_17_PRO_FRAME,
      {
        source: {} as CanvasImageSource,
        width: 2622,
        height: 1206,
        orientation: "landscape_left",
        surfaceWidth: 2622,
        surfaceHeight: 1206,
        touches: [],
      },
      REAL_IPHONE_17_PRO_ARTWORK,
    );

    const scale = canvasLayout.width / 2980;
    const artworkShadow = context.calls.find((call) =>
      call.name === "drawImage" &&
      call.args[0] === REAL_IPHONE_17_PRO_ARTWORK.source &&
      call.state.shadowBlur > 0
    );
    expect(artworkShadow?.state.shadowBlur).toBeCloseTo(46 * scale);
    expect(artworkShadow?.state.shadowOffsetX).toBeCloseTo(
      (2980 + 2730 + 4 * 46) * scale,
    );
  });

  test("maps single and multi-touch indicators from normalized display coordinates", () => {
    const ctx = new RecordingContext();
    const snapshot = {
      source: {} as CanvasImageSource,
      width: 100,
      height: 200,
      orientation: "portrait" as const,
      surfaceWidth: 100,
      surfaceHeight: 200,
      touches: [
        { x: 0.25, y: 0.75, kind: "single" as const },
        { x: 0.8, y: 0.2, kind: "multi" as const },
      ],
    };

    paintRecordingFrame(
      ctx as unknown as CanvasRenderingContext2D,
      createRecordingLayout(snapshot),
      snapshot,
    );

    expect(ctx.calls.filter((call) => call.name === "arc").map((call) => call.args.slice(0, 3))).toEqual([
      [25, 150, 12],
      [80, 40, 10],
    ]);
  });

  test("moves the Dynamic Island with every iPhone orientation", () => {
    const cases = [
      ["landscape_left", "right"],
      ["landscape_right", "left"],
      ["portrait_upside_down", "bottom"],
    ] as const;

    for (const [orientation, edge] of cases) {
      const ctx = new RecordingContext();
      const snapshot = {
        source: {} as CanvasImageSource,
        width: 391,
        height: 845,
        orientation,
        surfaceWidth: 391,
        surfaceHeight: 845,
        touches: [],
      };
      const layout = createRecordingLayout(snapshot, "iphone");
      paintRecordingFrame(ctx as unknown as CanvasRenderingContext2D, layout, snapshot);
      const islandStart = ctx.calls.filter((call) => call.name === "moveTo").at(-1)?.args;

      expect(islandStart).toBeDefined();
      if (edge === "right") {
        expect(islandStart![0] as number).toBeGreaterThan(layout.width * 0.8);
      } else if (edge === "left") {
        expect(islandStart![0] as number).toBeLessThan(layout.width * 0.2);
      } else {
        expect(islandStart![1] as number).toBeGreaterThan(layout.height * 0.8);
      }
    }
  });
});

describe("CanvasScreenRecorder lifecycle", () => {
  test("limits compositor snapshots to the requested recording frame rate", () => {
    const platform = new FakeRecorderPlatform();
    let snapshots = 0;
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => {
          snapshots++;
          return {
            source: {} as CanvasImageSource,
            width: 100,
            height: 200,
            surfaceWidth: 100,
            surfaceHeight: 200,
            touches: [],
          };
        },
      },
      fps: 30,
    }, platform);

    recorder.start();
    for (let frame = 1; frame <= 120; frame++) {
      const entry = platform.rafCallbacks.entries().next().value;
      expect(entry).toBeDefined();
      const [id, callback] = entry!;
      platform.rafCallbacks.delete(id);
      platform.nowMs = 1_000 + frame * (1_000 / 120);
      callback(platform.nowMs);
    }

    expect(platform.captureFrameRates).toEqual([30]);
    expect(snapshots).toBeGreaterThanOrEqual(30);
    expect(snapshots).toBeLessThanOrEqual(32);
    recorder.cancel();
  });

  test("records framed artifacts at the padded canvas dimensions", async () => {
    const platform = new FakeRecorderPlatform();
    const source = {
      snapshot: () => ({
        source: {} as CanvasImageSource,
        width: 1206,
        height: 2622,
        orientation: "portrait" as const,
        surfaceWidth: 1206,
        surfaceHeight: 2622,
        touches: [],
      }),
    };
    const recorder = new CanvasScreenRecorder({
      source,
      deviceFrame: IPHONE_17_PRO_FRAME,
    }, platform);

    recorder.start();
    expect({ width: platform.canvas.width, height: platform.canvas.height }).toEqual({
      width: 1564,
      height: 2980,
    });
    const finished = recorder.stop();
    platform.recorder.finish();
    const artifact = await finished;

    expect({ width: artifact.width, height: artifact.height }).toEqual({
      width: 1564,
      height: 2980,
    });
  });

  test("stop includes the final chunk and releases active browser resources", async () => {
    const platform = new FakeRecorderPlatform();
    const source = {
      snapshot: () => ({
        source: {} as CanvasImageSource,
        width: 100,
        height: 200,
        orientation: "portrait" as const,
        surfaceWidth: 100,
        surfaceHeight: 200,
        touches: [],
      }),
    };
    const recorder = new CanvasScreenRecorder({ source }, platform);

    recorder.start();
    const finished = recorder.stop();
    platform.recorder.emit("first-");
    platform.recorder.emit("final");
    platform.nowMs = 3_500;
    platform.recorder.finish();
    const artifact = await finished;

    expect(await artifact.blob.text()).toBe("first-final");
    expect(artifact.mimeType).toBe("video/mp4");
    expect(artifact.url).toBe("blob:recording-1");
    expect(artifact.filename).toBe("simulator-20260711123456.mp4");
    expect(artifact.durationSeconds).toBe(2.5);
    expect(platform.recorder.requests).toBe(1);
    expect(platform.recorder.stops).toBe(1);
    expect(platform.track.stops).toBe(1);
    expect(platform.cancelledRafs).toHaveLength(1);
  });

  test("repeated stop calls share the same completion", async () => {
    const platform = new FakeRecorderPlatform();
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          orientation: "portrait",
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
    }, platform);

    recorder.start();
    const first = recorder.stop();
    const second = recorder.stop();
    void second.catch(() => {});

    expect(second).toBe(first);
    platform.recorder.finish();
    await first;
    expect(platform.recorder.stops).toBe(1);
  });

  test("cancel is repeatable and discards the partial recording", async () => {
    const platform = new FakeRecorderPlatform();
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
    }, platform);

    recorder.start();
    platform.recorder.emit("partial");
    recorder.cancel();
    recorder.cancel();
    platform.recorder.finish();

    expect(recorder.state).toBe("cancelled");
    expect(platform.recorder.stops).toBe(1);
    expect(platform.track.stops).toBe(1);
    expect(platform.cancelledRafs).toHaveLength(1);
    expect(platform.revokedUrls).toEqual([]);
    await expect(recorder.stop()).rejects.toThrow("not recording");
  });

  test("an asynchronous encoder error is reported and releases resources", async () => {
    const platform = new FakeRecorderPlatform();
    const reported: Error[] = [];
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
      onError: (error) => { reported.push(error); },
    }, platform);

    recorder.start();
    platform.recorder.fail(new Error("encoder failed"));

    expect(recorder.state).toBe("error");
    expect(reported[0]?.message).toBe("encoder failed");
    expect(platform.recorder.stops).toBe(1);
    expect(platform.track.stops).toBe(1);
    expect(platform.cancelledRafs).toHaveLength(1);
    await expect(recorder.stop()).rejects.toThrow("encoder failed");
  });

  test("a compositor error inside an animation frame is reported and releases resources", () => {
    const platform = new FakeRecorderPlatform();
    const reported: Error[] = [];
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
      onError: (error) => reported.push(error),
    }, platform);

    recorder.start();
    platform.context.drawImageError = new Error("canvas became unreadable");
    const paint = [...platform.rafCallbacks.values()][0]!;
    platform.nowMs += 1_000 / 30;

    expect(() => paint(platform.nowMs)).not.toThrow();
    expect(recorder.state).toBe("error");
    expect(reported[0]?.message).toBe("canvas became unreadable");
    expect(platform.track.stops).toBe(1);
    expect(platform.cancelledRafs).toHaveLength(1);
  });

  test("auto format falls through when a supported recorder cannot be constructed", () => {
    class FallbackPlatform extends FakeRecorderPlatform {
      attempts: string[] = [];

      override isTypeSupported(mimeType: string) {
        return mimeType === "video/mp4" || mimeType === "video/webm;codecs=vp9";
      }

      override createMediaRecorder(stream: RecorderMediaStream, options: MediaRecorderOptions) {
        const mimeType = options.mimeType ?? "";
        this.attempts.push(mimeType);
        if (mimeType.startsWith("video/mp4")) throw new Error("MP4 encoder unavailable");
        return super.createMediaRecorder(stream, options);
      }
    }
    const platform = new FallbackPlatform();
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
    }, platform);

    recorder.start();

    expect(platform.attempts).toEqual(["video/mp4", "video/webm;codecs=vp9"]);
    expect(platform.recorder.mimeType).toBe("video/webm;codecs=vp9");
    recorder.cancel();
  });

  test("cancel after completion revokes the artifact URL exactly once", async () => {
    const platform = new FakeRecorderPlatform();
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
    }, platform);

    recorder.start();
    const finished = recorder.stop();
    platform.recorder.emit("video");
    platform.recorder.finish();
    const artifact = await finished;
    recorder.cancel();
    recorder.cancel();

    expect(platform.revokedUrls).toEqual([artifact.url]);
  });

  test("artifact creation failure rejects stop and still releases resources", async () => {
    class FailingUrlPlatform extends FakeRecorderPlatform {
      override createObjectURL(): string { throw new Error("object URL failed"); }
    }
    const platform = new FailingUrlPlatform();
    const recorder = new CanvasScreenRecorder({
      source: {
        snapshot: () => ({
          source: {} as CanvasImageSource,
          width: 100,
          height: 200,
          surfaceWidth: 100,
          surfaceHeight: 200,
          touches: [],
        }),
      },
    }, platform);

    recorder.start();
    const finished = recorder.stop();
    platform.recorder.emit("video");

    expect(() => platform.recorder.finish()).not.toThrow();
    await expect(finished).rejects.toThrow("object URL failed");
    expect(recorder.state).toBe("error");
    expect(platform.track.stops).toBe(1);
    expect(platform.cancelledRafs).toHaveLength(1);
  });
});
