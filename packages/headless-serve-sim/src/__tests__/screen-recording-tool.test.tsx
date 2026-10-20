import { describe, expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ScreenRecordingTool,
  frameSelectionAfterDeviceChange,
  recordingFrameDescription,
  recordingFormatSupport,
} from "../client/components/screen-recording-tool";
import {
  recordingCaptureMeta,
  recordingNotice,
  recordingStatus,
  useScreenRecording,
  type ScreenRecordingOptions,
} from "../client/hooks/use-screen-recording";
import { CaptureTab } from "../client/inspector/capture-tab";
import type { InspectorProps } from "../client/inspector/types";
import { ShellContext, type Shell } from "../client/shell/shell-context";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSimMiddleware } from "../middleware";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const frameSpec: DeviceFrameSpec = {
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

test("initial browser bundle does not include the native MP4 muxer", async () => {
  const bundle = await Bun.build({
    entrypoints: [new URL("../client/client.tsx", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  expect(bundle.success).toBe(true);
  const map = JSON.parse(
    await bundle.outputs.find((output) => output.path.endsWith(".map"))!.text(),
  ) as {
    sources: string[];
  };
  expect(map.sources.some((source) => source.includes("mediabunny"))).toBe(false);
});

test("standalone native recorder module has no React runtime imports", async () => {
  const bundle = await Bun.build({
    entrypoints: [new URL("../client/native-stream-recorder.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  expect(bundle.success).toBe(true);
  const map = JSON.parse(
    await bundle.outputs.find((output) => output.path.endsWith(".map"))!.text(),
  ) as {
    sources: string[];
  };
  expect(map.sources.some((source) => source.includes("mediabunny"))).toBe(true);
  expect(map.sources.some((source) => /node_modules\/.*(react|preact)/.test(source))).toBe(false);
});

test("serves the offline recorder module under the middleware mount after the admin guard", async () => {
  const payload = 'export const NativeStreamRecorder = "offline-module";';
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__NATIVE_RECORDER_JS_B64__");
  Object.defineProperty(globalThis, "__NATIVE_RECORDER_JS_B64__", {
    configurable: true,
    value: Buffer.from(payload).toString("base64"),
  });
  try {
    for (const basePath of ["/", "/preview"]) {
      const host = createScriptedHostCommands();
      const handler = createSimMiddleware(host, {
        basePath,
        serveSimBin: "fixture-cli",
        allowRemoteAdmin: false,
      });
      const request = async (remoteAddress: string) => {
        let status = 0;
        let headers: Record<string, string> = {};
        let body = "";
        await new Promise<void>((resolve, reject) => {
          handler(
            {
              method: "GET",
              url: `${basePath === "/" ? "" : basePath}/native-stream-recorder.js`,
              headers: {},
              socket: { remoteAddress },
            } as IncomingMessage,
            {
              writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
                status = nextStatus;
                headers = nextHeaders;
              },
              end(value: string | Buffer) {
                body = value.toString();
                resolve();
              },
            } as unknown as ServerResponse,
            (error) => (error ? reject(error) : resolve()),
          );
        });
        return { status, headers, body };
      };
      try {
        const local = await request("127.0.0.1");
        expect(local.status).toBe(200);
        expect(local.body).toBe(payload);
        expect(local.headers["Content-Type"]).toContain("javascript");
        expect(local.headers["X-Content-Type-Options"]).toBe("nosniff");
        expect((await request("192.168.1.50")).status).toBe(404);
        expect(host.calls).toHaveLength(0);
      } finally {
        handler.dispose();
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "__NATIVE_RECORDER_JS_B64__", previous);
    else Reflect.deleteProperty(globalThis, "__NATIVE_RECORDER_JS_B64__");
  }
});

test.each(["ready", "cancel", "device", "stream", "unmount", "source", "failure"])(
  "lazy recorder handles %s while its module loads",
  async (scenario) => {
    const key = `__lazyRecorderFixture_${scenario}`;
    let release!: () => void;
    let requested = 0;
    let moduleRequested!: () => void;
    const moduleRequest = new Promise<void>((resolve) => {
      moduleRequested = resolve;
    });
    let started = 0;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(globalThis, {
      [key]: {
        barrier,
        requested: () => {
          requested++;
          moduleRequested();
        },
        started: () => started++,
        artifact: {
          blob: new Blob(["mp4"], { type: "video/mp4" }),
          url: "blob:recording",
          filename: "simulator-recording.mp4",
          mimeType: "video/mp4",
          durationSeconds: 12.4,
          bytes: 4.2 * 1024 * 1024,
          width: 1206,
          height: 2622,
        },
      },
    });
    const code = `const fixture=globalThis[${JSON.stringify(key)}]; fixture.requested(); await fixture.barrier; ${scenario === "failure" ? 'throw new Error("module unavailable");' : ""} export class NativeStreamRecorder { start(){fixture.started()} cancel(){} async stop(){return fixture.artifact} } //`;
    const globals = Object.getOwnPropertyDescriptor(globalThis, "window");
    const handlers = new Map<string, () => void>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __SIM_PREVIEW__: { basePath: `data:text/javascript,${encodeURIComponent(code)}` },
        addEventListener: (name: string, handler: () => void) => handlers.set(name, handler),
        removeEventListener: (name: string) => handlers.delete(name),
      },
    });
    const refs: { current: unknown }[] = [];
    const states: unknown[] = [];
    let refIndex = 0;
    let stateIndex = 0;
    let effects: React.EffectCallback[] = [];
    const spies = [
      spyOn(React, "useEffect").mockImplementation((effect) => {
        effects.push(effect);
      }),
      spyOn(React, "useRef").mockImplementation((initial) => {
        const index = refIndex++;
        return refs[index] ?? (refs[index] = { current: initial });
      }),
      spyOn(React, "useState").mockImplementation((initial?: any) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (value: any) => {
            states[index] = typeof value === "function" ? value(states[index]) : value;
          },
        ] as any;
      }),
      spyOn(React, "useCallback").mockImplementation((callback) => callback),
    ];
    const finished: { blob: Blob; filename: string; meta: string }[] = [];
    const sourceRef = { current: { snapshot: () => null, subscribeEncoded: () => () => {} } };
    const options = {
      sourceRef,
      deviceFrameSpec: null,
      deviceKey: "DUO",
      streaming: true,
      touchMarkersAvailable: false,
      onFinished: (file: { blob: Blob; filename: string; meta: string }) => finished.push(file),
    };
    // Effects in registration order: 0 mount/pagehide, 1 device change,
    // 2 frame artwork, 3 stream end.
    const render = () => {
      refIndex = stateIndex = 0;
      effects = [];
      return useScreenRecording(options as ScreenRecordingOptions);
    };
    let cleanup: ReturnType<React.EffectCallback> = undefined;
    try {
      const view = render();
      cleanup = effects[0]!();
      view.start();
      view.start();
      await moduleRequest;
      expect(requested).toBe(1);
      expect(started).toBe(0);
      const loadingView = render();
      expect(loadingView.status).toBe("preparing");
      if (scenario === "cancel") loadingView.stop();
      if (scenario === "device") {
        options.deviceKey = "OTHER";
        render();
        effects[1]!();
      }
      if (scenario === "stream") {
        options.streaming = false;
        render();
        effects[3]!();
      }
      if (scenario === "unmount" && typeof cleanup === "function") cleanup();
      if (scenario === "source") sourceRef.current = { ...sourceRef.current };
      release();
      await Bun.sleep(0);
      expect(started).toBe(scenario === "ready" ? 1 : 0);
      const settled = render();
      if (scenario !== "unmount")
        expect(settled.status).toBe(scenario === "ready" ? "recording" : "idle");
      if (scenario === "failure") expect(settled.error).toBe("module unavailable");
      if (scenario === "ready") {
        expect(settled.startedAt).toBeNumber();
        settled.stop();
        await Bun.sleep(0);
        const done = render();
        expect(done.status).toBe("idle");
        expect(done.startedAt).toBeNull();
        expect(done.artifact?.filename).toBe("simulator-recording.mp4");
        expect(finished).toHaveLength(1);
        expect(finished[0]!.filename).toBe("simulator-recording.mp4");
        expect(finished[0]!.meta).toBe("0:12 · 4.2 MB · MP4");
      } else {
        expect(finished).toHaveLength(0);
      }
    } finally {
      release();
      if (typeof cleanup === "function") cleanup();
      spies.forEach((spy) => spy.mockRestore());
      Reflect.deleteProperty(globalThis, key);
      if (globals) Object.defineProperty(globalThis, "window", globals);
      else Reflect.deleteProperty(globalThis, "window");
    }
  },
);

test("the native recorder is warmed while idle, so the first start doesn't wait on it", async () => {
  const key = "__warmRecorderFixture";
  let requested = 0;
  let started = 0;
  Object.assign(globalThis, {
    [key]: { requested: () => requested++, started: () => started++ },
  });
  const code = `const fixture=globalThis[${JSON.stringify(key)}]; fixture.requested(); export class NativeStreamRecorder { start(){fixture.started()} cancel(){} async stop(){} } //`;
  const globals = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __SIM_PREVIEW__: { basePath: `data:text/javascript,${encodeURIComponent(code)}` },
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const idle = Object.getOwnPropertyDescriptor(globalThis, "requestIdleCallback");
  Object.defineProperty(globalThis, "requestIdleCallback", {
    configurable: true,
    value: (callback: () => void) => {
      callback();
      return 1;
    },
  });
  const refs: { current: unknown }[] = [];
  const states: unknown[] = [];
  let refIndex = 0;
  let stateIndex = 0;
  let effects: React.EffectCallback[] = [];
  const spies = [
    spyOn(React, "useEffect").mockImplementation((effect) => {
      effects.push(effect);
    }),
    spyOn(React, "useRef").mockImplementation((initial) => {
      const index = refIndex++;
      return refs[index] ?? (refs[index] = { current: initial });
    }),
    spyOn(React, "useState").mockImplementation((initial?: any) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: any) => {
          states[index] = typeof value === "function" ? value(states[index]) : value;
        },
      ] as any;
    }),
    spyOn(React, "useCallback").mockImplementation((callback) => callback),
  ];
  const options = {
    sourceRef: { current: { snapshot: () => null, subscribeEncoded: () => () => {} } },
    deviceFrameSpec: null,
    deviceKey: "DUO",
    streaming: true,
    touchMarkersAvailable: false,
  };
  const render = () => {
    refIndex = stateIndex = 0;
    effects = [];
    return useScreenRecording(options as ScreenRecordingOptions);
  };
  try {
    render();
    // Effects in registration order: … 3 stream end, 4 recorder warm-up.
    effects[4]!();
    for (let i = 0; i < 100 && requested === 0; i++) await Bun.sleep(1);
    expect(requested).toBe(1);
    expect(started).toBe(0);
    render().start();
    for (let i = 0; i < 100 && started === 0; i++) await Bun.sleep(1);
    expect(started).toBe(1);
    expect(requested).toBe(1);
  } finally {
    spies.forEach((spy) => spy.mockRestore());
    Reflect.deleteProperty(globalThis, key);
    if (globals) Object.defineProperty(globalThis, "window", globals);
    else Reflect.deleteProperty(globalThis, "window");
    if (idle) Object.defineProperty(globalThis, "requestIdleCallback", idle);
    else Reflect.deleteProperty(globalThis, "requestIdleCallback");
  }
});

/** The hook is owned by client.tsx; for markup tests, own it here. */
function Recorder({
  stream,
  ...options
}: Omit<ScreenRecordingOptions, "deviceFrameSpec" | "touchMarkersAvailable"> & {
  deviceFrameSpec?: ScreenRecordingOptions["deviceFrameSpec"];
  touchMarkersAvailable?: boolean;
  stream?: { mode: "perf" | "quality"; modeAvailable: boolean };
}) {
  const recording = useScreenRecording({
    deviceFrameSpec: null,
    touchMarkersAvailable: true,
    ...options,
  });
  if (!stream) return <ScreenRecordingTool recording={recording} />;
  const props = {
    udid: "DEVICE-1",
    foldable: false,
    streaming: options.streaming,
    recording,
    stream: { ...stream, onModeChange() {} },
  } as unknown as InspectorProps;
  const shell = { captures: [], toast: () => 0, addCapture() {} } as unknown as Shell;
  return (
    <ShellContext.Provider value={shell}>
      <CaptureTab {...props} />
    </ShellContext.Provider>
  );
}

/** The opening tag of the switch labelled `label`. */
function switchTag(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*role="switch"[^>]*aria-label="${label}"[^>]*>`))![0];
}

test("native MP4 recording is available without a browser re-encoder", () => {
  const html = renderToStaticMarkup(
    <Recorder
      sourceRef={{ current: { snapshot: () => null, subscribeEncoded: () => () => {} } }}
      deviceKey="DUO"
      streaming
      touchMarkersAvailable={false}
    />,
  );
  expect(html).not.toContain("Screen recording is not supported in this browser.");
  expect(html).toContain("Start recording");
  expect(switchTag(html, "Device frame")).toContain('disabled=""');
});

describe("ScreenRecordingTool", () => {
  test("clears a selected frame when the device changes or loses its profile", () => {
    expect(frameSelectionAfterDeviceChange(true, "A", "B", true)).toBe(false);
    expect(frameSelectionAfterDeviceChange(true, "A", "A", false)).toBe(false);
    expect(frameSelectionAfterDeviceChange(true, "A", "A", true)).toBe(true);
  });

  test("reports support separately so an unavailable container can be disabled", () => {
    expect(recordingFormatSupport((mimeType) => mimeType.startsWith("video/webm"))).toEqual({
      auto: true,
      mp4: false,
      webm: true,
    });
  });

  test("discloses real-frame preparation and fallback states", () => {
    expect(recordingFrameDescription(frameSpec, true, false)).toBe(
      "Preparing real hardware frame…",
    );
    expect(recordingFrameDescription(frameSpec, false, true)).toBe(
      "Real frame unavailable — using simple frame",
    );
    expect(recordingFrameDescription(frameSpec, false, false)).toBe("iPhone 17 Pro");
  });

  test("keeps a generic device frame available without DeviceKit metadata", () => {
    const html = renderToStaticMarkup(
      <Recorder
        sourceRef={{ current: null }}
        deviceFrameSpec="iphone"
        deviceKey="DEVICE-1"
        streaming
      />,
    );

    expect(html).toContain("Generic iPhone frame");
    // A generic frame stays selectable when DeviceKit ships no metadata.
    expect(switchTag(html, "Device frame")).not.toContain('disabled=""');
  });

  test("renders format, touch, frame, capture, and unsupported-browser states", () => {
    const html = renderToStaticMarkup(
      <Recorder
        sourceRef={{ current: null }}
        deviceFrameSpec={frameSpec}
        deviceKey="DEVICE-1"
        streaming
        stream={{ mode: "quality", modeAvailable: true }}
      />,
    );

    expect(html).toContain("Screen recording");
    expect(html).toContain('aria-label="Recording format"');
    expect(html).toContain("Auto");
    expect(html).toContain("MP4");
    expect(html).toContain("WebM");
    expect(html).toContain("Show touches");
    expect(html).toContain("Device frame");
    expect(html).toContain("iPhone 17 Pro");
    expect(html).toContain('aria-label="Stream quality"');
    expect(html).toContain("Start recording");
    expect(html).toContain("Screen recording is not supported in this browser.");
    expect(html).toContain("Screenshots and recordings from this session appear here.");
  });

  test("disables touch markers for a rendered model without touch metadata", () => {
    const html = renderToStaticMarkup(
      <Recorder
        sourceRef={{ current: null }}
        deviceKey="DEVICE-1"
        streaming
        touchMarkersAvailable={false}
      />,
    );
    const control = switchTag(html, "Show touches");
    expect(control).toContain('disabled=""');
    expect(control).toContain('aria-checked="false"');
    expect(html).toContain("Touch markers are unavailable in the 3D view.");
  });

  test("disables the stream mode while the simulator is disconnected", () => {
    const html = renderToStaticMarkup(
      <Recorder
        sourceRef={{ current: null }}
        deviceKey="DEVICE-1"
        streaming={false}
        stream={{ mode: "quality", modeAvailable: true }}
      />,
    );
    expect(html).toContain('aria-label="Stream quality"');
    expect(html).toMatch(/aria-checked="true"[^>]*disabled=""[^>]*><span[^>]*>Quality/);
    expect(html).toMatch(/aria-checked="false"[^>]*disabled=""[^>]*><span[^>]*>Performance/);
  });

  test("hides the native stream switch when recording from MJPEG", () => {
    const html = renderToStaticMarkup(
      <Recorder
        sourceRef={{ current: null }}
        deviceFrameSpec={frameSpec}
        deviceKey="DEVICE-1"
        streaming
        stream={{ mode: "perf", modeAvailable: false }}
      />,
    );
    expect(html).not.toContain('aria-label="Stream quality"');
  });
});

describe("useScreenRecording state", () => {
  test("maps recorder phases onto the shell's recording status", () => {
    expect(recordingStatus("idle")).toBe("idle");
    expect(recordingStatus("starting")).toBe("preparing");
    expect(recordingStatus("recording")).toBe("recording");
    expect(recordingStatus("stopping")).toBe("finishing");
  });

  test("explains why recording can't start: browser first, then stream", () => {
    const none = { auto: false, mp4: false, webm: false };
    const all = { auto: true, mp4: true, webm: true };
    expect(recordingNotice(none, false)).toBe("Screen recording is not supported in this browser.");
    expect(recordingNotice(all, false)).toBe("Waiting for the simulator stream.");
    expect(recordingNotice(all, true)).toBeNull();
  });

  test("captions a finished recording with duration, size and container", () => {
    expect(
      recordingCaptureMeta({
        durationSeconds: 12.9,
        bytes: 4.2 * 1024 * 1024,
        mimeType: "video/mp4",
      }),
    ).toBe("0:12 · 4.2 MB · MP4");
    expect(
      recordingCaptureMeta({
        durationSeconds: 75,
        bytes: 300 * 1024,
        mimeType: "video/webm;codecs=vp9",
      }),
    ).toBe("1:15 · 300 KB · WebM");
  });
});
