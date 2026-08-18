import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { createServer, type Server } from "http";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { WebSocket, WebSocketServer } from "ws";
import { createSimMiddleware, parsePhonePreviewPath } from "../middleware";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const DEVICE = "11111111-2222-3333-4444-555555555555";
const TOKEN = "phone-preview-secret";
const LINK_TOKEN = createHmac("sha256", TOKEN).update(DEVICE).digest("base64url");
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startPreview(remoteAddress?: string, forwardedFor?: string): Promise<string> {
  const helper = createServer((req, res) => {
    if (req.url === "/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ width: 393, height: 852, orientation: "portrait" }));
      return;
    }
    if (req.url === "/stream.mjpeg") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("stream-bytes");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const helperSockets = new WebSocketServer({ server: helper, path: "/ws" });
  helperSockets.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data.toString()}`));
  });
  await new Promise<void>((resolve) => helper.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => helper.close(() => resolve())));
  const helperPort = (helper.address() as AddressInfo).port;

  const stateDir = mkdtempSync(join(tmpdir(), "phone-preview-route-"));
  cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }));
  writeFileSync(
    join(stateDir, `server-${DEVICE}.json`),
    JSON.stringify({
      pid: process.pid,
      port: helperPort,
      device: DEVICE,
      url: `http://127.0.0.1:${helperPort}`,
      streamUrl: `http://127.0.0.1:${helperPort}/stream.mjpeg`,
      wsUrl: `ws://127.0.0.1:${helperPort}/ws`,
    }),
  );

  const booted = JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
        { udid: DEVICE, name: "iPhone", state: "Booted", isAvailable: true },
      ],
    },
  });
  const host = createScriptedHostCommands(
    Array.from({ length: 8 }, () => ({ result: { stdout: booted } })),
    { alivePids: [process.pid] },
  );
  const handler = createSimMiddleware(host, {
    basePath: "/",
    device: DEVICE,
    execToken: "desktop-exec-token",
    serveSimBin: "test-headless-serve-sim",
    stateDir,
    proxyHelpers: true,
    allowRemoteAdmin: false,
    phonePreview: {
      token: TOKEN,
      origin: "http://192.168.1.42:3200",
    },
  });
  const server: Server = createServer((req, res) => {
    if (remoteAddress) Object.defineProperty(req.socket, "remoteAddress", { value: remoteAddress });
    if (forwardedFor) req.headers["x-forwarded-for"] = forwardedFor;
    handler(req, res, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (remoteAddress) Object.defineProperty(req.socket, "remoteAddress", { value: remoteAddress });
    if (forwardedFor) req.headers["x-forwarded-for"] = forwardedFor;
    if (!handler.handleUpgrade?.(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("phone preview route", () => {
  test("does not let a device link pivot to another simulator", () => {
    const otherDevice = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

    expect(parsePhonePreviewPath(`/phone/${LINK_TOKEN}/${otherDevice}`, TOKEN)).toBeNull();
  });

  test("serves a token-scoped page without desktop capabilities", async () => {
    Object.assign(globalThis, {
      __PREVIEW_HTML_B64__: Buffer.from(
        '<!doctype html><div id="root"></div><!--__SIM_PREVIEW_CONFIG__-->',
      ).toString("base64"),
    });
    const origin = await startPreview();

    const response = await fetch(`${origin}/phone/${LINK_TOKEN}/${DEVICE}`);
    const html = await response.text();

    const injected = html.match(/window\.__SIM_PREVIEW__=(\{.*?\})<\/script>/)?.[1];
    const config = JSON.parse(injected ?? "null") as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(config.mode).toBe("phone");
    expect(config.wsUrl).toBe(`${origin.replace("http", "ws")}/phone/${LINK_TOKEN}/${DEVICE}/ws`);
    expect(Object.keys(config).sort()).toEqual(["device", "mode", "url", "wsUrl"]);
    expect(html).not.toContain("desktop-exec-token");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).toContain(
      `connect-src 'self' ${origin.replace("http", "ws")}`,
    );
  });

  test("hides desktop routes from LAN requests", async () => {
    const origin = await startPreview("192.168.1.50");

    for (const path of ["/", "/api", "/exec", "/grid/api/start", `/helper/${DEVICE}/config`]) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(404);
    }
  });

  test("does not trust forwarded remote requests as loopback", async () => {
    const origin = await startPreview(undefined, "203.0.113.10");

    const response = await fetch(`${origin}/`);

    expect(response.status).toBe(404);
  });

  test("proxies only the token-scoped video endpoint", async () => {
    const origin = await startPreview("192.168.1.50");

    const allowed = await fetch(`${origin}/phone/${LINK_TOKEN}/${DEVICE}/stream.mjpeg`);
    const denied = await fetch(`${origin}/phone/wrong-token/${DEVICE}/stream.mjpeg`);

    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("stream-bytes");
    expect(denied.status).toBe(404);
  });

  test("publishes the selected-device phone link to the desktop UI", async () => {
    const origin = await startPreview();

    const response = await fetch(`${origin}/api?device=${DEVICE}`);
    const config = (await response.json()) as { phonePreviewUrl?: string };

    expect(config.phonePreviewUrl).toBe(`http://192.168.1.42:3200/phone/${LINK_TOKEN}/${DEVICE}`);
  });

  test("proxies the token-scoped touch WebSocket", async () => {
    const origin = await startPreview("192.168.1.50");
    const socket = new WebSocket(
      `${origin.replace("http", "ws")}/phone/${LINK_TOKEN}/${DEVICE}/ws`,
    );
    cleanups.push(() => socket.close());

    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no reply")), 2_000);
      socket.on("open", () => socket.send("hello"));
      socket.on("message", (data) => {
        clearTimeout(timer);
        resolve(data.toString());
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    expect(reply).toBe("echo:hello");
  });
});
