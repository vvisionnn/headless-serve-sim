import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevFetchHandler } from "../../dev";
import type { CommandRequest, CommandResult, HostCommands } from "../runtime/host-commands";
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
        kind: "run",
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

  test("slow boot discovery is shared without blocking unrelated requests", async () => {
    const pending = Promise.withResolvers<CommandResult>();
    const modes: ("sync" | undefined)[] = [];
    const host = createScriptedHostCommands([], { alivePids: [HELPER_PID] });
    host.run = ((_request: CommandRequest, mode?: "sync") => {
      modes.push(mode);
      return pending.promise;
    }) as HostCommands["run"];
    let now = 0;
    const handler = createDevFetchHandler({
      hostCommands: host,
      stateDir: createStateDir(),
      serveSimBin: "test-headless-serve-sim",
      resolveDeviceMetadata: async () => undefined,
      now: () => now,
    });

    let completed = false;
    const first = handler(new Request(`http://localhost/api?device=${DEVICE}`)).then((response) => {
      completed = true;
      return response;
    });
    const second = handler(new Request(`http://localhost/api?device=${DEVICE}`));
    const unrelated = await handler(new Request("http://localhost/grid/api/missing"));
    expect(unrelated.status).toBe(404);
    expect(completed).toBe(false);
    expect(modes).toEqual([undefined]);

    // A slow command's cache lifetime begins when it completes, not when it
    // started; otherwise the next metrics poll immediately spawns another one.
    now = 2_000;
    pending.resolve({
      exitCode: 0,
      signal: null,
      stdout: Buffer.from(
        JSON.stringify({ devices: { test: [{ udid: DEVICE, state: "Booted" }] } }),
      ),
      stderr: Buffer.alloc(0),
      timedOut: false,
    });
    for (const response of await Promise.all([first, second])) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ device: DEVICE });
    }
    await handler(new Request(`http://localhost/api?device=${DEVICE}`));
    expect(modes).toEqual([undefined]);
    now = 3_501;
    await handler(new Request(`http://localhost/api?device=${DEVICE}`));
    expect(modes).toEqual([undefined, undefined]);
  });

  test("a lookup started before shutdown cannot restore the invalidated cache", async () => {
    const pending = Promise.withResolvers<CommandResult>();
    const host = createScriptedHostCommands(
      [{}, { result: { stdout: JSON.stringify({ devices: {} }) } }],
      { alivePids: [HELPER_PID] },
    );
    const run = host.run;
    let lookups = 0;
    host.run = ((request: CommandRequest) => {
      if (request.args?.[1] === "list" && ++lookups === 1) return pending.promise;
      return run(request);
    }) as HostCommands["run"];
    const handler = createDevFetchHandler({
      hostCommands: host,
      stateDir: createStateDir(),
      serveSimBin: "test-headless-serve-sim",
      resolveDeviceMetadata: async () => undefined,
    });
    const staleRead = handler(new Request(`http://localhost/api?device=${DEVICE}`));
    await Promise.resolve();
    const shutdown = await handler(
      new Request("http://localhost/grid/api/shutdown", {
        method: "POST",
        body: JSON.stringify({ udid: DEVICE }),
      }),
    );
    expect(shutdown.status).toBe(200);
    pending.resolve({
      exitCode: 0,
      signal: null,
      stdout: Buffer.from(
        JSON.stringify({ devices: { test: [{ udid: DEVICE, state: "Booted" }] } }),
      ),
      stderr: Buffer.alloc(0),
      timedOut: false,
    });
    await staleRead;
    const refreshed = await handler(new Request(`http://localhost/api?device=${DEVICE}`));
    expect(await refreshed.json()).toBeNull();
    expect(lookups).toBe(2);
    expect(host.remaining).toBe(0);
  });

  test("aborted discovery never starts logs or app-state subprocesses", async () => {
    for (const endpoint of ["logs", "appstate"]) {
      const release = Promise.withResolvers<void>();
      const host = createScriptedHostCommands(
        [
          {
            result: {
              stdout: JSON.stringify({ devices: { test: [{ udid: DEVICE, state: "Booted" }] } }),
            },
          },
        ],
        { alivePids: [HELPER_PID] },
      );
      const run = host.run;
      host.run = ((request: CommandRequest) =>
        release.promise.then(() => run(request))) as HostCommands["run"];
      const handler = createDevFetchHandler({
        hostCommands: host,
        stateDir: createStateDir(),
        serveSimBin: "test-headless-serve-sim",
        resolveDeviceMetadata: async () => undefined,
      });
      const controller = new AbortController();
      const response = handler(
        new Request(`http://localhost/${endpoint}?device=${DEVICE}`, { signal: controller.signal }),
      );
      controller.abort();
      release.resolve();
      expect((await response).status).toBe(499);
      expect(host.calls.map((call) => call.kind)).toEqual(["run"]);
    }
  });

  test("successful shutdown invalidates lookups started while it was running", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const host = createScriptedHostCommands(
      [
        {
          result: {
            stdout: JSON.stringify({ devices: { test: [{ udid: DEVICE, state: "Booted" }] } }),
          },
        },
        {},
        { result: { stdout: JSON.stringify({ devices: {} }) } },
      ],
      { alivePids: [HELPER_PID] },
    );
    const run = host.run;
    host.run = ((request: CommandRequest) => {
      if (request.args?.[1] === "shutdown") {
        started.resolve();
        return release.promise.then(() => run(request));
      }
      return run(request);
    }) as HostCommands["run"];
    const handler = createDevFetchHandler({
      hostCommands: host,
      stateDir: createStateDir(),
      serveSimBin: "test-headless-serve-sim",
      resolveDeviceMetadata: async () => undefined,
    });
    const shutdown = handler(
      new Request("http://localhost/grid/api/shutdown", {
        method: "POST",
        body: JSON.stringify({ udid: DEVICE }),
      }),
    );
    await started.promise;
    const during = await handler(new Request(`http://localhost/api?device=${DEVICE}`));
    expect(await during.json()).toMatchObject({ device: DEVICE });
    release.resolve();
    expect((await shutdown).status).toBe(200);
    const after = await handler(new Request(`http://localhost/api?device=${DEVICE}`));
    expect(await after.json()).toBeNull();
    expect(host.remaining).toBe(0);
  });
});
