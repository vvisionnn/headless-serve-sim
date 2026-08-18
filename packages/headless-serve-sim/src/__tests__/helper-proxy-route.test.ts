import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "http";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AddressInfo } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { createSimMiddleware } from "../middleware";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const DEVICE = "PROXY-UDID";
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A stand-in stream helper: one HTTP route plus a WebSocket echo. */
async function startFakeHelper(): Promise<{ origin: string; port: number }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/config")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ width: 393, height: 852, url: req.url }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data.toString()}`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return { origin: `http://127.0.0.1:${port}`, port };
}

/** Preview server with helper proxying on, backed by a written state file. */
async function startPreview(helper: { origin: string; port: number }): Promise<string> {
  const stateDir = mkdtempSync(join(tmpdir(), "helper-proxy-test-"));
  cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }));
  writeFileSync(
    join(stateDir, `server-${DEVICE}.json`),
    JSON.stringify({
      pid: process.pid,
      port: helper.port,
      device: DEVICE,
      url: helper.origin,
      streamUrl: `${helper.origin}/stream.mjpeg`,
      wsUrl: `ws://127.0.0.1:${helper.port}/ws`,
    }),
  );

  // The state reaper drops any helper whose pid is dead or whose simulator
  // isn't booted, so both have to be scripted or the proxy finds no helper.
  const simctlBooted = JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
        { udid: DEVICE, name: "iPhone", state: "Booted", isAvailable: true },
      ],
    },
  });
  const host = createScriptedHostCommands(
    Array.from({ length: 16 }, () => ({ result: { stdout: simctlBooted } })),
    { alivePids: [process.pid] },
  );
  const handler = createSimMiddleware(host, {
    basePath: "/",
    execToken: "tok",
    serveSimBin: "test-headless-serve-sim",
    stateDir,
    proxyHelpers: true,
    device: DEVICE,
  });
  const server: Server = createServer((req, res) => {
    handler(req, res, () => {
      if (!res.headersSent) res.statusCode = 404;
      res.end("Not found");
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (!handler.handleUpgrade?.(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("helper proxy", () => {
  test("forwards an HTTP request to the helper", async () => {
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const res = await fetch(`${origin}/helper/${DEVICE}/config`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { width: number }).toMatchObject({ width: 393 });
  });

  test("preserves the query string", async () => {
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const res = await fetch(`${origin}/helper/${DEVICE}/config?raw=1`);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("/config?raw=1");
  });

  test("404s for a device with no helper", async () => {
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const res = await fetch(`${origin}/helper/NOT-A-DEVICE/config`);
    expect(res.status).toBe(404);
  });

  // The tunnel replays the handshake verbatim; if the key or version were
  // dropped the upgrade would fail rather than merely misbehave.
  test("tunnels a WebSocket through to the helper", async () => {
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const wsUrl = `${origin.replace("http", "ws")}/helper/${DEVICE}/ws`;
    const socket = new WebSocket(wsUrl);
    cleanups.push(() => socket.close());

    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no reply")), 5000);
      socket.on("open", () => socket.send("hello"));
      socket.on("message", (data) => {
        clearTimeout(timer);
        resolve(data.toString());
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    expect(reply).toBe("echo:hello");
  }, 15_000);

  test("rejects a cross-origin helper WebSocket", async () => {
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const socket = new WebSocket(`${origin.replace("http", "ws")}/helper/${DEVICE}/ws`, {
      headers: { Origin: "http://evil.example" },
    });
    cleanups.push(() => socket.close());

    const opened = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2_000);
      socket.on("open", () => {
        clearTimeout(timer);
        resolve(true);
      });
      socket.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });

    expect(opened).toBe(false);
  });

  test("the exec channel still upgrades with proxying on", async () => {
    // The helper tunnel must not swallow upgrades that belong to /exec-ws.
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const socket = new WebSocket(`${origin.replace("http", "ws")}/exec-ws`);
    cleanups.push(() => socket.close());
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("exec-ws never opened")), 5000);
      socket.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }, 15_000);

  test("the injected preview config points at the proxy, not the helper port", async () => {
    const helper = await startFakeHelper();
    const origin = await startPreview(helper);
    const res = await fetch(`${origin}/api`);
    const config = (await res.json()) as { streamUrl: string; wsUrl: string } | null;
    expect(config).not.toBeNull();
    expect(config!.streamUrl).toContain(`/helper/${DEVICE}/stream.mjpeg`);
    expect(config!.streamUrl).not.toContain(String(helper.port));
    expect(config!.wsUrl).toContain(`/helper/${DEVICE}/ws`);
  });
});
