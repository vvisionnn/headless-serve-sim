import { afterAll, describe, expect, test } from "bun:test";
import {
  fetchHelperScreenConfig,
  htmlSafeJson,
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

describe("htmlSafeJson — inline-<script> XSS escaping", () => {
  test("escapes <, >, & and the U+2028/U+2029 line terminators", () => {
    const out = htmlSafeJson({ s: "<>&\u2028\u2029" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u2028");
  });

  test("is value-preserving — the client's JSON.parse reads the identical object", () => {
    // Includes spaces + parens + unicode to guard against over-escaping (a
    // real device name like "iPad Pro 13-inch (M5)" must survive untouched).
    const value = { deviceName: "iPad Pro 13-inch (M5) — café </script> <b>&", n: 42, nested: { a: [1, "<x>"] } };
    expect(JSON.parse(htmlSafeJson(value))).toEqual(value);
  });

  test("a </script> device name cannot break out of the inline script tag", () => {
    const evil = 'Evil</script><script>fetch("/exec")</script>';
    const config = htmlSafeJson(
      previewConfigForState(state, "", "/bin/headless-serve-sim", "tok", null, evil),
    );
    // The serialized payload carries no sequence that closes the <script>.
    expect(config.toLowerCase()).not.toContain("</script>");
    expect(config).not.toContain("<");
    // …yet the value the client parses is exactly the original name.
    expect(JSON.parse(config).deviceName).toBe(evil);
  });
});
