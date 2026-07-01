import { afterAll, describe, expect, test } from "bun:test";
import {
  fetchHelperScreenConfig,
  parseScreenConfig,
  previewConfigForState,
  type ServeSimState,
} from "../middleware";

const state: ServeSimState = {
  pid: 100,
  port: 3102,
  device: "UDID-1",
  url: "http://127.0.0.1:3102",
  streamUrl: "http://127.0.0.1:3102/stream.mjpeg",
  wsUrl: "ws://127.0.0.1:3102/ws",
};

describe("parseScreenConfig", () => {
  test("accepts positive dimensions and keeps orientation", () => {
    expect(parseScreenConfig({ width: 1206, height: 2622, orientation: "portrait" })).toEqual({
      width: 1206,
      height: 2622,
      orientation: "portrait",
    });
  });

  test("omits a missing / non-string orientation", () => {
    expect(parseScreenConfig({ width: 10, height: 20 })).toEqual({ width: 10, height: 20 });
    expect(parseScreenConfig({ width: 10, height: 20, orientation: 3 })).toEqual({
      width: 10,
      height: 20,
    });
  });

  test("rejects zero / negative dimensions (helper not ready yet)", () => {
    expect(parseScreenConfig({ width: 0, height: 0, orientation: "portrait" })).toBeNull();
    expect(parseScreenConfig({ width: -1, height: 20 })).toBeNull();
  });

  test("rejects non-numeric or malformed payloads", () => {
    expect(parseScreenConfig({ width: "1206", height: 2622 })).toBeNull();
    expect(parseScreenConfig(null)).toBeNull();
    expect(parseScreenConfig("nope")).toBeNull();
    expect(parseScreenConfig({})).toBeNull();
  });
});

describe("previewConfigForState — screenConfig injection", () => {
  test("includes screenConfig when supplied", () => {
    const cfg = previewConfigForState(state, "", "/bin/headless-serve-sim", "tok", {
      width: 1206,
      height: 2622,
      orientation: "portrait",
    });
    expect(cfg.screenConfig).toEqual({ width: 1206, height: 2622, orientation: "portrait" });
  });

  test("omits screenConfig when absent (backward compatible)", () => {
    expect(previewConfigForState(state, "", "/bin/headless-serve-sim", "tok").screenConfig).toBeUndefined();
    expect(previewConfigForState(state, "", "/bin/headless-serve-sim", "tok", null).screenConfig).toBeUndefined();
  });

  test("includes deviceName when supplied, omits it otherwise", () => {
    const withName = previewConfigForState(state, "", "/bin/headless-serve-sim", "tok", null, "iPad Pro 13-inch (M5)");
    expect(withName.deviceName).toBe("iPad Pro 13-inch (M5)");
    expect(previewConfigForState(state, "", "/bin/headless-serve-sim", "tok").deviceName).toBeUndefined();
    expect(previewConfigForState(state, "", "/bin/headless-serve-sim", "tok", null, null).deviceName).toBeUndefined();
  });
});

describe("fetchHelperScreenConfig", () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/config") {
        return Response.json({ width: 1320, height: 2868, orientation: "portrait" });
      }
      if (pathname === "/bad") return Response.json({ width: 0, height: 0 });
      return new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  afterAll(() => server.stop(true));

  test("returns the validated config from a live helper", async () => {
    expect(await fetchHelperScreenConfig(base)).toEqual({
      width: 1320,
      height: 2868,
      orientation: "portrait",
    });
  });

  test("returns null on an unreachable helper (best-effort, never throws)", async () => {
    // Nothing is listening here, so the fetch fails fast and falls back.
    expect(await fetchHelperScreenConfig("http://127.0.0.1:1", 100)).toBeNull();
  });
});
