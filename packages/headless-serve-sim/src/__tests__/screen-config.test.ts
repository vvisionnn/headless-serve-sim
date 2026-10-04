import { describe, expect, test } from "bun:test";
import {
  fallbackScreenSize,
  simulatorAspectRatio,
  type StreamConfig,
} from "headless-serve-sim-client/simulator";
import { resolveActiveScreenConfig } from "../client/utils/screen-config";
import { parseScreenConfig } from "../middleware";

test("injected helper configuration preserves the composition frame mode", () => {
  for (const includeFrame of [true, false]) {
    expect(
      parseScreenConfig({ width: 3420, height: 3420, deviceComposition: true, includeFrame }),
    ).toEqual({
      width: 3420,
      height: 3420,
      deviceComposition: true,
      includeFrame,
    });
  }
  expect(parseScreenConfig({ width: 3420, height: 3420, includeFrame: "false" })).toEqual({
    width: 3420,
    height: 3420,
  });
});

const iPad: StreamConfig = { width: 2064, height: 2752, orientation: "portrait" };
const iPhone: StreamConfig = { width: 1206, height: 2622, orientation: "portrait" };
// The generic per-type guess used before any real config is known.
const genericFallback = fallbackScreenSize("iphone");

describe("resolveActiveScreenConfig — priority", () => {
  test("uses the injected config when nothing live has arrived yet", () => {
    expect(resolveActiveScreenConfig({ injected: iPad, fallback: genericFallback })).toEqual(iPad);
  });

  test("live overrides ws and injected", () => {
    expect(
      resolveActiveScreenConfig({
        live: iPhone,
        ws: iPad,
        injected: iPad,
        fallback: genericFallback,
      }),
    ).toEqual(iPhone);
  });

  test("ws overrides injected", () => {
    expect(
      resolveActiveScreenConfig({ ws: iPhone, injected: iPad, fallback: genericFallback }),
    ).toEqual(iPhone);
  });

  test("falls back to the generic guess when nothing else is known", () => {
    expect(resolveActiveScreenConfig({ fallback: genericFallback })).toEqual(genericFallback);
  });

  test("ignores a not-ready config with zero dimensions", () => {
    const notReady = { width: 0, height: 0, orientation: "portrait" } as StreamConfig;
    // A zero-sized injected config must not size the frame — fall through.
    expect(resolveActiveScreenConfig({ injected: notReady, fallback: genericFallback })).toEqual(
      genericFallback,
    );
    // Zero-sized live falls through to the usable injected seed.
    expect(
      resolveActiveScreenConfig({ live: notReady, injected: iPad, fallback: genericFallback }),
    ).toEqual(iPad);
  });
});

test("a new active display config supersedes pixels from the previous panel", () => {
  const inner = {
    width: 2007,
    height: 2853,
    orientation: "landscape_right",
    displayId: 3,
  } as StreamConfig;
  const outer = {
    width: 1398,
    height: 2034,
    orientation: "portrait",
    displayId: 1,
  } as StreamConfig;
  expect(resolveActiveScreenConfig({ live: inner, ws: outer, fallback: genericFallback })).toEqual(
    outer,
  );
});

test("new composition capability supersedes an older raw live config", () => {
  const raw: StreamConfig = { width: 2007, height: 2853, displayId: 3 };
  const composed: StreamConfig = {
    width: 3420,
    height: 3420,
    displayId: 3,
    deviceComposition: true,
  };
  expect(resolveActiveScreenConfig({ live: raw, ws: composed, fallback: genericFallback })).toEqual(
    composed,
  );
});

describe("resolveActiveScreenConfig — no first-paint resize (regression)", () => {
  test("injected geometry matches the eventual live geometry, not the generic fallback", () => {
    // First paint: only the injected __SIM_PREVIEW__.screenConfig is known.
    const firstPaint = resolveActiveScreenConfig({ injected: iPad, fallback: genericFallback });
    // A moment later the live/ws config lands (identical geometry from /config).
    const afterLive = resolveActiveScreenConfig({
      live: iPad,
      injected: iPad,
      fallback: genericFallback,
    });

    // The frame's aspect ratio is identical across the two → no resize.
    expect(simulatorAspectRatio(firstPaint)).toBe(simulatorAspectRatio(afterLive));
    // And it is NOT the generic fallback aspect that caused the visible jump.
    expect(simulatorAspectRatio(firstPaint)).not.toBe(simulatorAspectRatio(genericFallback));
  });
});
