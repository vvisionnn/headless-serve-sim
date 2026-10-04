import { describe, expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ScreenRecordingTool,
  frameSelectionAfterDeviceChange,
  recordingFrameDescription,
  recordingFormatSupport,
} from "../client/components/screen-recording-tool";
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
      },
    });
    const code = `const fixture=globalThis[${JSON.stringify(key)}]; fixture.requested(); await fixture.barrier; ${scenario === "failure" ? 'throw new Error("module unavailable");' : ""} export class NativeStreamRecorder { start(){fixture.started()} cancel(){} } //`;
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
    const sourceRef = { current: { snapshot: () => null, subscribeEncoded: () => () => {} } };
    const props = {
      sourceRef,
      deviceKey: "DUO",
      streaming: true,
      streamMode: "quality" as const,
      streamModeAvailable: false,
      onStreamModeChange() {},
      touchMarkersAvailable: false,
      initiallyOpen: true,
    };
    const render = () => {
      refIndex = stateIndex = 0;
      effects = [];
      return ScreenRecordingTool(props);
    };
    let cleanup: ReturnType<React.EffectCallback> = undefined;
    try {
      const view = render();
      cleanup = effects[0]!();
      view.props.children[1].props.children[5].props.onClick();
      view.props.children[1].props.children[5].props.onClick();
      await moduleRequest;
      expect(requested).toBe(1);
      expect(started).toBe(0);
      const loadingView = render();
      expect(states[4]).toBe("starting");
      if (scenario === "cancel")
        loadingView.props.children[1].props.children[5].props.children[1].props.onClick();
      if (scenario === "device") {
        props.deviceKey = "OTHER";
        render();
        effects[1]!();
      }
      if (scenario === "stream") {
        props.streaming = false;
        render();
        effects[3]!();
      }
      if (scenario === "unmount" && typeof cleanup === "function") cleanup();
      if (scenario === "source") sourceRef.current = { ...sourceRef.current };
      release();
      await Bun.sleep(0);
      expect(started).toBe(scenario === "ready" ? 1 : 0);
      if (scenario !== "unmount")
        expect(states[4]).toBe(scenario === "ready" ? "recording" : "idle");
      if (scenario === "failure") expect(states[7]).toBe("module unavailable");
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

test("native MP4 recording is available without a browser re-encoder", () => {
  const html = renderToStaticMarkup(
    <ScreenRecordingTool
      sourceRef={{ current: { snapshot: () => null, subscribeEncoded: () => () => {} } }}
      deviceKey="DUO"
      streaming
      streamMode="quality"
      streamModeAvailable
      onStreamModeChange={() => {}}
      touchMarkersAvailable={false}
      initiallyOpen
    />,
  );
  expect(html).not.toContain("Screen recording is not supported in this browser.");
  expect(html).toContain("Start recording");
  const frameStart = html.indexOf('data-setting-row="Device frame"');
  const frameControl = html.slice(frameStart, html.indexOf("</button>", frameStart));
  expect(frameControl).toContain('disabled=""');
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
      <ScreenRecordingTool
        sourceRef={{ current: null }}
        deviceFrameSpec="iphone"
        deviceKey="DEVICE-1"
        streaming
        streamMode="perf"
        streamModeAvailable={false}
        onStreamModeChange={() => {}}
        initiallyOpen
      />,
    );

    expect(html).toContain("Generic iPhone frame");
    // The row is a design-system switch now, not a bare checkbox — same intent:
    // a generic frame stays selectable when DeviceKit ships no metadata.
    const frameStart = html.indexOf('data-setting-row="Device frame"');
    const frameControl = html.slice(frameStart, html.indexOf("</button>", frameStart));
    expect(frameControl).toContain('role="switch"');
    // The attribute, not the substring — `disabled:opacity-45` is a variant class.
    expect(frameControl).not.toContain('disabled=""');
  });

  test("renders format, touch, frame, capture, and unsupported-browser states", () => {
    const html = renderToStaticMarkup(
      <ScreenRecordingTool
        sourceRef={{ current: null }}
        deviceFrameSpec={frameSpec}
        deviceKey="DEVICE-1"
        streaming
        streamMode="quality"
        streamModeAvailable
        onStreamModeChange={() => {}}
        initiallyOpen
      />,
    );

    expect(html).toContain("Screen Recording");
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
  });

  test("disables touch markers for a rendered model without touch metadata", () => {
    const html = renderToStaticMarkup(
      <ScreenRecordingTool
        sourceRef={{ current: null }}
        deviceKey="DEVICE-1"
        streaming
        streamMode="perf"
        streamModeAvailable={false}
        onStreamModeChange={() => {}}
        touchMarkersAvailable={false}
        initiallyOpen
      />,
    );
    const start = html.indexOf('data-setting-row="Show touches"');
    const control = html.slice(start, html.indexOf("</button>", start));
    expect(control).toContain('disabled=""');
    expect(control).toContain('aria-checked="false"');
    expect(html).toContain("Touch markers are unavailable in the 3D view.");
  });

  test("hides the native stream switch when recording from MJPEG", () => {
    const html = renderToStaticMarkup(
      <ScreenRecordingTool
        sourceRef={{ current: null }}
        deviceFrameSpec={frameSpec}
        deviceKey="DEVICE-1"
        streaming
        streamMode="perf"
        streamModeAvailable={false}
        onStreamModeChange={() => {}}
        initiallyOpen
      />,
    );
    expect(html).not.toContain('aria-label="Stream quality"');
  });
});
