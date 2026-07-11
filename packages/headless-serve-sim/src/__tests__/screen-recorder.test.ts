import { describe, expect, test } from "bun:test";
import {
  CanvasScreenRecorder,
  createRecordingLayout,
  paintRecordingFrame,
  recordingExtension,
  selectRecordingMimeType,
  type RecorderCanvas,
  type RecorderMediaRecorder,
  type RecorderMediaStream,
  type ScreenRecorderPlatform,
} from "../client/screen-recorder";

class RecordingContext {
  calls: Array<{ name: string; args: unknown[] }> = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  globalAlpha = 1;
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  drawImageError: Error | null = null;

  private call(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }

  save() { this.call("save"); }
  restore() { this.call("restore"); }
  clearRect(...args: number[]) { this.call("clearRect", ...args); }
  fillRect(...args: number[]) { this.call("fillRect", ...args); }
  beginPath() { this.call("beginPath"); }
  moveTo(...args: number[]) { this.call("moveTo", ...args); }
  lineTo(...args: number[]) { this.call("lineTo", ...args); }
  quadraticCurveTo(...args: number[]) { this.call("quadraticCurveTo", ...args); }
  closePath() { this.call("closePath"); }
  clip() { this.call("clip"); }
  fill() { this.call("fill"); }
  stroke() { this.call("stroke"); }
  arc(...args: number[]) { this.call("arc", ...args); }
  translate(...args: number[]) { this.call("translate", ...args); }
  rotate(...args: number[]) { this.call("rotate", ...args); }
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
  readonly canvas: RecorderCanvas = {
    width: 0,
    height: 0,
    getContext: () => this.context as unknown as CanvasRenderingContext2D,
    captureStream: () => this.stream,
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
      width: 428,
      height: 882,
    });
    expect(layout.screenRect).toEqual({
      x: 18.5,
      y: 18.5,
      width: 391,
      height: 845,
    });
  });

  test("produces valid even-sized layouts for every generic frame family", () => {
    for (const deviceFrame of ["iphone", "ipad", "watch", "vision"] as const) {
      const layout = createRecordingLayout(
        { width: 400, height: 800, orientation: "portrait" },
        deviceFrame,
      );
      expect(layout.width % 2).toBe(0);
      expect(layout.height % 2).toBe(0);
      expect(layout.screenRect.width).toBeGreaterThanOrEqual(400);
      expect(layout.screenRect.height).toBeGreaterThanOrEqual(800);
    }
  });

  test("rotates portrait frame geometry around a landscape screen", () => {
    const layout = createRecordingLayout(
      { width: 845, height: 391, orientation: "landscape_left" },
      "iphone",
    );

    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 882,
      height: 428,
    });
    expect(layout.screenRect).toEqual({
      x: 18.5,
      y: 18.5,
      width: 845,
      height: 391,
    });
  });
});

describe("screen recording composition", () => {
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

  test("contains a later landscape frame inside the recording's fixed portrait canvas", () => {
    const ctx = new RecordingContext();
    const layout = createRecordingLayout({ width: 100, height: 200, orientation: "portrait" });

    paintRecordingFrame(ctx as unknown as CanvasRenderingContext2D, layout, {
      source: {} as CanvasImageSource,
      width: 200,
      height: 100,
      orientation: "landscape_left",
      surfaceWidth: 200,
      surfaceHeight: 100,
      touches: [],
    });

    expect(ctx.calls.find((call) => call.name === "drawImage")?.args.slice(-4)).toEqual([
      -50,
      -25,
      100,
      50,
    ]);
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

    expect(() => paint(0)).not.toThrow();
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
