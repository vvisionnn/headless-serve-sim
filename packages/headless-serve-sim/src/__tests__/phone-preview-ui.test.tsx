import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PhoneFullscreenToggle,
  clampPhoneFullscreenButton,
  fullscreenVideoGeometry,
  phoneFullscreenCorner,
  releaseVelocity,
  shouldUseNativeVideoFullscreen,
} from "../client/components/phone-fullscreen-toggle";
import { PhonePreview } from "../client/components/phone-preview";

describe("PhonePreview", () => {
  test("renders only an edge-to-edge interactive stream", () => {
    const html = renderToStaticMarkup(
      <PhonePreview
        config={{
          mode: "phone",
          device: "11111111-2222-3333-4444-555555555555",
          url: "http://192.168.1.42:3200/phone/token/device",
          wsUrl: "ws://192.168.1.42:3200/phone/token/device/ws",
        }}
      />,
    );

    expect(html).toContain('data-phone-preview="true"');
    expect(html).toContain("100dvh");
    expect(html).toContain('data-testid="simulator-input"');
    expect(html).toContain('data-phone-fullscreen-toggle="true"');
    expect(html).toContain('aria-label="Enter fullscreen"');
    expect(html).toContain("<video");
    expect(html).toContain("playsInline");
    expect(html).not.toContain(">Home<");
    expect(html).not.toContain("0 fps");
  });

  test("keeps the control visible when fullscreen support cannot be detected", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    try {
      const html = renderToStaticMarkup(
        <PhoneFullscreenToggle
          targetRef={{ current: null }}
          recordingSourceRef={{ current: null }}
        />,
      );
      expect(html).toContain('data-phone-fullscreen-toggle="true"');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  test("uses native video only when element fullscreen is unavailable", () => {
    const video = { webkitEnterFullscreen() {} };
    expect(shouldUseNativeVideoFullscreen({}, video)).toBe(true);
    expect(shouldUseNativeVideoFullscreen({ requestFullscreen: async () => {} }, video)).toBe(
      false,
    );
    expect(shouldUseNativeVideoFullscreen({}, {})).toBe(false);
  });

  test("rotates only portrait-encoded landscape frames", () => {
    expect(
      fullscreenVideoGeometry({
        width: 1260,
        height: 2736,
        orientation: "landscape_left",
        surfaceWidth: 390,
        surfaceHeight: 180,
      }),
    ).toEqual({ width: 2736, height: 1260, rotation: 90 });
    expect(
      fullscreenVideoGeometry({
        width: 2736,
        height: 1260,
        orientation: "landscape_left",
        surfaceWidth: 390,
        surfaceHeight: 180,
      }),
    ).toEqual({ width: 2736, height: 1260, rotation: 0 });
    expect(
      fullscreenVideoGeometry({
        width: 1260,
        height: 2736,
        surfaceWidth: 390,
        surfaceHeight: 180,
      }),
    ).toEqual({ width: 2736, height: 1260, rotation: 90 });
  });

  test("keeps the fullscreen control inside the viewport", () => {
    expect(clampPhoneFullscreenButton({ x: -100, y: 900 }, { width: 390, height: 844 })).toEqual({
      x: 8,
      y: 792,
    });
    expect(clampPhoneFullscreenButton({ x: 500, y: -20 }, { width: 390, height: 844 })).toEqual({
      x: 338,
      y: 8,
    });
  });

  test("a released button rests in the nearest corner", () => {
    const viewport = { width: 390, height: 844 };
    expect(phoneFullscreenCorner({ x: 40, y: 60 }, { x: 0, y: 0 }, viewport)).toEqual({
      x: 16,
      y: 16,
    });
    expect(phoneFullscreenCorner({ x: 300, y: 700 }, { x: 0, y: 0 }, viewport)).toEqual({
      x: 330,
      y: 784,
    });
  });

  test("a flick lands in the corner it was heading for, not the one it left from", () => {
    const viewport = { width: 390, height: 844 };
    // Released near the top-left, but thrown hard down and to the right.
    expect(phoneFullscreenCorner({ x: 60, y: 120 }, { x: 1500, y: 3000 }, viewport)).toEqual({
      x: 330,
      y: 784,
    });
    // A gentle nudge doesn't carry it across the screen.
    expect(phoneFullscreenCorner({ x: 60, y: 120 }, { x: 50, y: 50 }, viewport)).toEqual({
      x: 16,
      y: 16,
    });
  });

  test("release velocity comes from the last 100 ms of movement", () => {
    expect(releaseVelocity([])).toEqual({ x: 0, y: 0 });
    expect(
      releaseVelocity([
        { x: 0, y: 0, t: 0 },
        { x: 0, y: 0, t: 400 },
        { x: 10, y: -20, t: 450 },
        { x: 50, y: -100, t: 500 },
      ]),
    ).toEqual({ x: 500, y: -1000 });
  });
});
