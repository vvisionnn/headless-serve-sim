import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ScreenRecordingTool,
  recordingFormatSupport,
} from "../client/components/screen-recording-tool";

describe("ScreenRecordingTool", () => {
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
        deviceType="iphone"
        deviceKey="DEVICE-1"
        streaming
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
    expect(html).toContain("Start recording");
    expect(html).toContain("Screen recording is not supported in this browser.");
  });
});
