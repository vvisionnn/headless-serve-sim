import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ScreenRecordingTool,
  frameSelectionAfterDeviceChange,
  recordingFormatSupport,
} from "../client/components/screen-recording-tool";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";

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
