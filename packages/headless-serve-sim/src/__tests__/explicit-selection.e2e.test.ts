import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSimMiddleware } from "../middleware";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function bootedResult(...udids: string[]) {
  return {
    result: {
      stdout: JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-Test": udids.map((udid) => ({
            udid,
            state: "Booted",
          })),
        },
      }),
    },
  };
}

function writeState(stateDir: string, device: string, pid: number, port: number): void {
  writeFileSync(
    join(stateDir, `server-${device}.json`),
    JSON.stringify({
      pid,
      port,
      device,
      url: `http://127.0.0.1:${port}`,
      streamUrl: `http://127.0.0.1:${port}/stream.mjpeg`,
      wsUrl: `ws://127.0.0.1:${port}/ws`,
    }),
  );
}

describe("explicit /api selection", () => {
  test("never connects until selected and never falls over to another booted device", async () => {
    const deviceA = "EXPLICIT-SELECTION-A";
    const deviceB = "EXPLICIT-SELECTION-B";
    const pidA = 59_321;
    const pidB = 59_322;
    const root = mkdtempSync(join(tmpdir(), "explicit-selection-e2e-"));
    createdDirs.push(root);
    const stateDir = join(root, "state");
    mkdirSync(stateDir);
    writeState(stateDir, deviceA, pidA, 59_321);
    writeState(stateDir, deviceB, pidB, 59_322);

    const host = createScriptedHostCommands(
      [bootedResult(deviceA, deviceB), bootedResult(deviceB)],
      { alivePids: [pidA, pidB] },
    );
    let now = 10_000;
    const handler = createSimMiddleware(host, {
      basePath: "/",
      execToken: "explicit-selection-e2e-token",
      serveSimBin: "test-headless-serve-sim",
      stateDir,
      now: () => now,
    });
    const server = createServer((req, res) =>
      handler(req, res, () => {
        res.statusCode = 404;
        res.end("Not found");
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;

    async function apiConfig(device?: string): Promise<{ device: string } | null> {
      const query = device ? `?device=${encodeURIComponent(device)}` : "";
      const response = await fetch(`${origin}/api${query}`);
      expect(response.status).toBe(200);
      return response.json() as Promise<{ device: string } | null>;
    }

    try {
      expect(await apiConfig()).toBeNull();
      expect((await apiConfig(deviceA))?.device).toBe(deviceA);
      expect((await apiConfig(deviceB))?.device).toBe(deviceB);

      now += 1_501;
      expect(await apiConfig(deviceA)).toBeNull();
      expect(await apiConfig()).toBeNull();
      expect((await apiConfig(deviceB))?.device).toBe(deviceB);

      expect(host.signals).toContainEqual({ pid: pidA, signal: "SIGTERM" });
      expect(host.calls.map((call) => call.kind)).toEqual(["run-sync", "run-sync"]);
      expect(host.remaining).toBe(0);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
