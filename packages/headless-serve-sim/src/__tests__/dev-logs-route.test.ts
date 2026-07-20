import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevFetchHandler } from "../../dev";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const DEVICE = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
const DEVICE_NAME = "Evil</script><script>window.pwned=true</script>";
const HELPER_PID = 3999;
const LOG_PID = 4000;
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createStateDir(): string {
  const root = mkdtempSync(join(tmpdir(), "hss-dev-logs-route-"));
  createdDirs.push(root);
  const stateDir = join(root, "state");
  mkdirSync(stateDir);
  writeFileSync(
    join(stateDir, `server-${DEVICE}.json`),
    JSON.stringify({
      pid: HELPER_PID,
      port: 3999,
      device: DEVICE,
      url: "http://127.0.0.1:3999",
      streamUrl: "http://127.0.0.1:3999/stream.mjpeg",
      wsUrl: "ws://127.0.0.1:3999/ws",
    }),
  );
  return stateDir;
}

describe("dev GET /logs", () => {
  test("serves metadata and streams the requested log filters through the host adapter", async () => {
    const host = createScriptedHostCommands(
      [
        {
          result: {
            stdout: JSON.stringify({
              devices: {
                "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [{ udid: DEVICE, state: "Booted" }],
              },
            }),
          },
        },
        {
          pid: LOG_PID,
          stdoutChunks: ['{"eventMessage":"route-works"}\n'],
          holdUntilStopped: true,
        },
      ],
      { alivePids: [HELPER_PID] },
    );
    const handler = createDevFetchHandler({
      hostCommands: host,
      stateDir: createStateDir(),
      serveSimBin: "test-headless-serve-sim",
      resolveDeviceMetadata: async () => ({
        deviceName: DEVICE_NAME,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      }),
    });

    const config = (await (
      await handler(new Request(`http://localhost/api?device=${DEVICE}`))
    ).json()) as { deviceName?: string; deviceTypeIdentifier?: string };
    expect(config).toMatchObject({
      deviceName: DEVICE_NAME,
      deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    });

    const html = await (await handler(new Request(`http://localhost/?device=${DEVICE}`))).text();
    expect(html).not.toContain(DEVICE_NAME);
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");

    const controller = new AbortController();
    const response = await handler(
      new Request(`http://localhost/logs?device=${DEVICE}&level=debug&processId=4242`, {
        signal: controller.signal,
      }),
    );
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    await Promise.resolve();

    expect(response.status).toBe(200);
    const value: unknown = chunk.value;
    const body = typeof value === "string" ? value : new TextDecoder().decode(value as Uint8Array);
    expect(body).toBe('data: {"eventMessage":"route-works"}\n\n');

    const invalid = await handler(
      new Request(`http://localhost/logs?device=${DEVICE}&level=fault`),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("Invalid log level");

    expect(host.calls).toEqual([
      {
        kind: "run-sync",
        request: {
          executable: "xcrun",
          args: ["simctl", "list", "devices", "booted", "-j"],
          stdio: "capture",
          timeoutMs: 3_000,
        },
      },
      {
        kind: "start",
        request: {
          executable: "xcrun",
          args: [
            "simctl",
            "spawn",
            DEVICE,
            "log",
            "stream",
            "--style",
            "ndjson",
            "--level",
            "debug",
            "--predicate",
            "processID == 4242",
          ],
          stdio: "stream",
        },
      },
    ]);
    expect(host.signals).toContainEqual({ pid: LOG_PID, signal: "SIGTERM" });
    expect(host.remaining).toBe(0);
  });
});
