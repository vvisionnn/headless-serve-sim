import { describe, expect, test } from "bun:test";
import { previewConfigKey } from "../client/utils/preview-config";

// A minimal config; only the fields previewConfigKey reads matter.
function cfg(over: Partial<NonNullable<Window["__SIM_PREVIEW__"]>>) {
  return {
    url: "http://127.0.0.1:3100",
    streamUrl: "http://127.0.0.1:3100/stream.mjpeg",
    wsUrl: "ws://127.0.0.1:3100/ws",
    pid: 100,
    port: 3100,
    device: "D",
    basePath: "",
    ...over,
  } as NonNullable<Window["__SIM_PREVIEW__"]>;
}

describe("previewConfigKey", () => {
  test("null config is the empty key", () => {
    expect(previewConfigKey(null)).toBe("");
  });

  test("a rotated execToken changes the key — the server-restart regression", () => {
    // The whole point: after a server restart the device/pid/stream are
    // unchanged but the token rotates. If the key ignored execToken (the old
    // bug), the pushed config looked identical, window.__SIM_PREVIEW__ kept the
    // dead token, and the control socket stayed closed until a manual reload.
    const before = previewConfigKey(cfg({ execToken: "tok-from-process-1" }));
    const after = previewConfigKey(cfg({ execToken: "tok-from-process-2" }));
    expect(after).not.toBe(before);
  });

  test("identical fields (token included) yield a stable key", () => {
    expect(previewConfigKey(cfg({ execToken: "t" }))).toBe(
      previewConfigKey(cfg({ execToken: "t" })),
    );
  });

  test("a missing token reads as empty, never the literal 'undefined'", () => {
    const key = previewConfigKey(cfg({}));
    expect(key).not.toContain("undefined");
    expect(key.endsWith(":")).toBe(true);
  });

  test("device / pid / streamUrl / wsUrl each contribute to identity", () => {
    const baseKey = previewConfigKey(cfg({ execToken: "t" }));
    expect(previewConfigKey(cfg({ execToken: "t", device: "E" }))).not.toBe(baseKey);
    expect(previewConfigKey(cfg({ execToken: "t", pid: 999 }))).not.toBe(baseKey);
    expect(previewConfigKey(cfg({ execToken: "t", streamUrl: "x" }))).not.toBe(baseKey);
    expect(previewConfigKey(cfg({ execToken: "t", wsUrl: "y" }))).not.toBe(baseKey);
  });

  test("late exact device metadata changes the key without a helper restart", () => {
    const baseKey = previewConfigKey(cfg({ execToken: "t" }));
    const deviceTypeIdentifier =
      "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
    const withIdentifier = previewConfigKey(cfg({
      execToken: "t",
      deviceTypeIdentifier,
    }));
    expect(withIdentifier).not.toBe(baseKey);
    expect(previewConfigKey(cfg({
      execToken: "t",
      deviceTypeIdentifier,
      deviceFrameSpec: {
        deviceTypeIdentifier,
        modelName: "iPhone 17 Pro",
        family: "iphone",
        nativeScreen: { width: 1206, height: 2622 },
        insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
        screenRadiiPx: {
          topLeft: 186,
          topRight: 186,
          bottomRight: 186,
          bottomLeft: 186,
        },
        outerRadiiPx: { x: 240, y: 240 },
        cutout: "dynamic-island",
        chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
      },
    }))).not.toBe(withIdentifier);
  });
});
