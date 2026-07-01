import type { StreamConfig } from "headless-serve-sim-client/simulator";

type ScreenConfigLike = Pick<StreamConfig, "width" | "height" | "orientation">;

/**
 * A config with usable pixel dimensions, or null. Guards against a helper that
 * answered before it knew the screen size ({width:0}) slipping into the frame
 * geometry and producing a divide-by-zero / zero-sized frame.
 */
function usable(config: ScreenConfigLike | null | undefined): ScreenConfigLike | null {
  if (!config) return null;
  return config.width > 0 && config.height > 0 ? config : null;
}

/**
 * Resolve the screen config that drives the device-frame geometry, highest
 * priority first:
 *   1. `live`     — dimensions the running stream reported (img onLoad / relay)
 *   2. `ws`       — the helper's 0x82 push over the control socket
 *   3. `injected` — screenConfig baked into __SIM_PREVIEW__ at page-serve time,
 *                   so the FIRST paint already sizes to the real device
 *   4. `fallback` — generic per-device-type guess when nothing else is known
 *
 * 1–3 are the same geometry at different latencies, so once a live/ws value
 * lands it matches the injected seed and the frame never resizes. Before this
 * seed existed the chain fell straight to the generic fallback on first paint,
 * then jumped when the real config arrived a moment later.
 */
export function resolveActiveScreenConfig(sources: {
  live?: StreamConfig | null;
  ws?: StreamConfig | null;
  injected?: ScreenConfigLike | null;
  fallback: { width: number; height: number };
}): ScreenConfigLike {
  return (
    usable(sources.live) ??
    usable(sources.ws) ??
    usable(sources.injected) ??
    sources.fallback
  );
}
