import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionStats, StreamConfig } from "headless-serve-sim-client/simulator";
import {
  FrameDeliveryStats,
  StreamStats,
  statSpread,
} from "../client/components/connection-stats-panel";

const stats: ConnectionStats = {
  fps: 59.6,
  bitrateBps: 8_000_000,
  jitterMs: 1,
  decodeMs: 2,
  droppedFrames: 7,
  frames: 120,
  codec: "avc1.640028",
  keyframeIntervalMs: 2000,
  recoveries: 0,
  server: {
    mode: "perf",
    targetBitrateBps: 12_000_000,
    maxQP: 46,
    congested: false,
    serverFps: 59.7,
    queueBytes: 0,
    queueMs: 0,
    droppedFrames: 0,
    sourceFps: 59.8,
    captureDroppedFrames: 3,
    encoderDroppedFrames: 4,
    transportDroppedChunks: 5,
  },
};

function text(snapshot: ConnectionStats): string {
  return renderToStaticMarkup(<FrameDeliveryStats stats={snapshot} />).replace(/<[^>]*>/g, "");
}

describe("FrameDeliveryStats", () => {
  test("separates observed rates and cumulative loss at each stage", () => {
    const output = text(stats);
    for (const value of [
      "Capture offers59.8 fps",
      "Encoded59.7 fps",
      "Painted59.6 fps",
      "Capture skipped3",
      "Encoder lost4",
      "Transport skipped5",
      "Browser discarded7",
      "helper lifetime",
      "all viewers",
    ]) {
      expect(output).toContain(value);
    }
  });

  test("idle is zero measured FPS with zero losses, never an implied 60fps deficit", () => {
    const output = text({
      ...stats,
      fps: 0,
      droppedFrames: 0,
      server: {
        ...stats.server!,
        sourceFps: 0,
        serverFps: 0,
        captureDroppedFrames: 0,
        encoderDroppedFrames: 0,
        transportDroppedChunks: 0,
      },
    });
    expect(output).toContain("Capture offers0.0 fps");
    expect(output).toContain("Painted0.0 fps");
    expect(output).toContain("Capture skipped0");
    expect(output).toContain("Browser discarded0");
    expect(output).toContain("Idle frames are not loss");
    expect(output).not.toContain("60");
  });

  test("unavailable server measurements are not reported as zero loss", () => {
    const output = text({ ...stats, server: null });
    expect(output).toContain("Capture offers—");
    expect(output).toContain("Encoded—");
    expect(output).toContain("Capture skipped—");
    expect(output).toContain("Encoder lost—");
    expect(output).toContain("Transport skipped—");
  });
});

describe("statSpread", () => {
  test("formats min · avg · max, and dashes before any data", () => {
    expect(statSpread([1, 2, 6], (n) => n.toFixed(0))).toBe("1 · 3 · 6");
    expect(statSpread([], (n) => n.toFixed(0))).toBe("— · — · —");
  });
});

describe("StreamStats", () => {
  test("shows live state, codec, resolution and the H.264 mode switch before any stats", () => {
    const html = renderToStaticMarkup(
      <StreamStats
        live
        codecMode="avcc"
        streamConfig={{ width: 1206, height: 2622 } as StreamConfig}
        sinkRef={{ current: null }}
        mode="perf"
        onModeChange={() => {}}
      />,
    );
    for (const value of [
      "Stream",
      "Live",
      "H.264",
      "1206×2622",
      'aria-label="Stream mode"',
      "Waiting for stream…",
    ]) {
      expect(html).toContain(value);
    }
  });

  test("MJPEG has no mode switch", () => {
    const html = renderToStaticMarkup(
      <StreamStats
        live={false}
        codecMode="mjpeg"
        streamConfig={null}
        sinkRef={{ current: null }}
        mode="perf"
        onModeChange={() => {}}
      />,
    );
    expect(html).toContain("Offline");
    expect(html).toContain("MJPEG");
    expect(html).not.toContain('aria-label="Stream mode"');
  });
});
