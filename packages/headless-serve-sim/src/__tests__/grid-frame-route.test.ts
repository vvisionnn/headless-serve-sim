import { describe, expect, test } from "bun:test";
import { createServer } from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AddressInfo } from "net";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { createSimMiddleware } from "../middleware";
import type { DeviceMetadata } from "../device-metadata";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const spec = {
  deviceTypeIdentifier: "type.iphone",
  modelName: "iPhone 17 Pro",
  family: "iphone",
  nativeScreen: { width: 1206, height: 2622 },
  insetsPx: { top: 40, right: 40, bottom: 40, left: 40 },
  screenRadiiPx: { topLeft: 160, topRight: 160, bottomRight: 160, bottomLeft: 160 },
  outerRadiiPx: { x: 200, y: 200 },
  cutout: "none",
  chromeIdentifier: "phone",
} as DeviceFrameSpec;

async function fetchFrame(
  path: string,
  resolve: (udid: string) => Promise<DeviceMetadata | undefined>,
): Promise<{ status: number; body: unknown }> {
  const stateDir = mkdtempSync(join(tmpdir(), "grid-frame-test-"));
  const handler = createSimMiddleware(createScriptedHostCommands([]), {
    basePath: "/",
    serveSimBin: "test-headless-serve-sim",
    stateDir,
    resolveDeviceMetadata: resolve,
  });
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(stateDir, { recursive: true, force: true });
  }
}

// The wall draws each running simulator in its real bezel, so it needs the
// frame spec for devices other than the one this page is streaming.
describe("/grid/api/frame", () => {
  test("returns the installed frame spec for the requested simulator", async () => {
    const asked: string[] = [];
    const { status, body } = await fetchFrame("/grid/api/frame?device=UDID-1", async (udid) => {
      asked.push(udid);
      return { deviceName: "iPhone 17 Pro", deviceFrameSpec: spec };
    });
    expect(status).toBe(200);
    expect(asked).toEqual(["UDID-1"]);
    expect(body).toEqual({ deviceFrameSpec: spec });
  });

  test("answers null when the simulator has no frame artwork", async () => {
    const { status, body } = await fetchFrame(
      "/grid/api/frame?device=UDID-2",
      async () => undefined,
    );
    expect(status).toBe(200);
    expect(body).toEqual({ deviceFrameSpec: null });
  });

  test("rejects a request without a device", async () => {
    const { status } = await fetchFrame("/grid/api/frame", async () => {
      throw new Error("must not resolve");
    });
    expect(status).toBe(400);
  });
});
