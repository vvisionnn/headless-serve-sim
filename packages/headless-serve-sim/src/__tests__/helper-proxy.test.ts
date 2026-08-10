import { describe, expect, test } from "bun:test";
import {
  helperProxyBase,
  parseHelperProxyPath,
  proxiedHelperUrls,
  requestIsSecure,
} from "../helper-proxy";

describe("parseHelperProxyPath", () => {
  test("splits the device from the helper-relative path", () => {
    expect(parseHelperProxyPath("", "/helper/UDID-1/stream.mjpeg")).toEqual({
      device: "UDID-1",
      path: "/stream.mjpeg",
    });
  });

  test("honors a mounted base path", () => {
    expect(parseHelperProxyPath("/.sim", "/.sim/helper/UDID-1/ws")).toEqual({
      device: "UDID-1",
      path: "/ws",
    });
  });

  test("a bare device maps to the helper root", () => {
    expect(parseHelperProxyPath("", "/helper/UDID-1")).toEqual({ device: "UDID-1", path: "/" });
    expect(parseHelperProxyPath("", "/helper/UDID-1/")).toEqual({ device: "UDID-1", path: "/" });
  });

  test("decodes a percent-encoded device", () => {
    expect(parseHelperProxyPath("", "/helper/A%2FB/config")?.device).toBe("A/B");
  });

  test("returns null for unrelated paths", () => {
    expect(parseHelperProxyPath("", "/grid/api")).toBeNull();
    expect(parseHelperProxyPath("/.sim", "/helper/UDID-1")).toBeNull();
  });

  test("returns null when no device is named", () => {
    expect(parseHelperProxyPath("", "/helper/")).toBeNull();
  });
});

describe("proxiedHelperUrls", () => {
  test("routes every helper URL through the preview origin", () => {
    const urls = proxiedHelperUrls("", "UDID-1", { host: "localhost:3200", secure: false });
    expect(urls.url).toBe("http://localhost:3200/helper/UDID-1");
    expect(urls.streamUrl).toBe("http://localhost:3200/helper/UDID-1/stream.mjpeg");
    expect(urls.wsUrl).toBe("ws://localhost:3200/helper/UDID-1/ws");
  });

  // A page served over https can't open a ws:// socket — the browser blocks it
  // as mixed content — so the scheme has to follow how the page was reached.
  test("uses wss and https when the request was secure", () => {
    const urls = proxiedHelperUrls("", "UDID-1", { host: "sim.example.com", secure: true });
    expect(urls.url.startsWith("https://")).toBe(true);
    expect(urls.wsUrl.startsWith("wss://")).toBe(true);
  });

  test("keeps the mount base", () => {
    expect(proxiedHelperUrls("/.sim", "U", { host: "h", secure: false }).streamUrl).toBe(
      "http://h/.sim/helper/U/stream.mjpeg",
    );
  });

  test("agrees with helperProxyBase", () => {
    const base = helperProxyBase("/.sim", "UDID-1");
    expect(proxiedHelperUrls("/.sim", "UDID-1", { host: "h", secure: false }).url).toBe(
      `http://h${base}`,
    );
  });
});

describe("requestIsSecure", () => {
  test("false without the header", () => {
    expect(requestIsSecure({})).toBe(false);
  });

  test("true for an https forwarded proto", () => {
    expect(requestIsSecure({ "x-forwarded-proto": "https" })).toBe(true);
  });

  test("reads the first hop of a chain", () => {
    expect(requestIsSecure({ "x-forwarded-proto": "https, http" })).toBe(true);
    expect(requestIsSecure({ "x-forwarded-proto": "http, https" })).toBe(false);
  });

  test("handles a repeated header", () => {
    expect(requestIsSecure({ "x-forwarded-proto": ["https", "http"] })).toBe(true);
  });
});
