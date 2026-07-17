import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { once } from "events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";

const DEVICE = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
const DEVICE_NAME = "Evil</script><script>window.pwned=true</script>";
const createdDirs: string[] = [];
const createdProcesses: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(createdProcesses.splice(0).map(stopProcess));
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "close").then(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function createHarness(): {
  tmpRoot: string;
  binDir: string;
  callsPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "hss-dev-logs-route-"));
  createdDirs.push(root);
  const tmpRoot = join(root, "tmp");
  const stateDir = join(tmpRoot, "headless-serve-sim");
  const binDir = join(root, "bin");
  const callsPath = join(root, "xcrun-calls.log");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(binDir);

  writeFileSync(
    join(stateDir, `server-${DEVICE}.json`),
    JSON.stringify({
      pid: process.pid,
      port: 3999,
      device: DEVICE,
      url: "http://127.0.0.1:3999",
      streamUrl: "http://127.0.0.1:3999/stream.mjpeg",
      wsUrl: "ws://127.0.0.1:3999/ws",
    }),
  );

  const xcrunPath = join(binDir, "xcrun");
  writeFileSync(
    xcrunPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$HSS_LOG_CALLS"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "booted" ]; then
  printf '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-0":[{"udid":"${DEVICE}","state":"Booted"}]}}\\n'
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  printf '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-0":[{"udid":"${DEVICE}","state":"Booted","name":${JSON.stringify(DEVICE_NAME)},"deviceTypeIdentifier":"com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"}]}}\\n'
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "spawn" ]; then
  printf '{"eventMessage":"route-works"}\\n'
  exit 0
fi
printf 'unexpected xcrun command: %s\\n' "$*" >&2
exit 1
`,
  );
  chmodSync(xcrunPath, 0o755);

  return { tmpRoot, binDir, callsPath };
}

async function fetchWhenReady(url: string): Promise<Response> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error("dev server did not start");
}

async function readSseMessage(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing SSE response body");
  const abort = setTimeout(() => reader.cancel(), 5_000);
  try {
    let body = "";
    while (!body.includes("route-works")) {
      const result = await reader.read();
      if (result.done) break;
      body += new TextDecoder().decode(result.value, { stream: true });
    }
    return body;
  } finally {
    clearTimeout(abort);
    await reader.cancel().catch(() => {});
  }
}

describe("dev GET /logs", () => {
  test("serves device metadata and uses requested log filters", async () => {
    const harness = createHarness();
    const port = await freePort();
    const devPath = resolve(import.meta.dir, "../../dev.ts");
    const dev = spawn(process.execPath, [devPath], {
      cwd: resolve(import.meta.dir, "../../../.."),
      env: {
        ...process.env,
        PORT: String(port),
        TMPDIR: harness.tmpRoot,
        PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
        HSS_LOG_CALLS: harness.callsPath,
      },
      stdio: "ignore",
    });
    createdProcesses.push(dev);

    const origin = `http://127.0.0.1:${port}`;
    const config = await (await fetchWhenReady(`${origin}/api?device=${DEVICE}`)).json() as {
      deviceName?: string;
      deviceTypeIdentifier?: string;
    };
    expect(config).toMatchObject({
      deviceName: DEVICE_NAME,
      deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    });

    const html = await (await fetch(`${origin}/?device=${DEVICE}`)).text();
    expect(html).not.toContain(DEVICE_NAME);
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");

    const response = await fetchWhenReady(
      `${origin}/logs?device=${DEVICE}&level=debug&processId=4242`,
    );
    expect(response.status).toBe(200);
    expect(await readSseMessage(response)).toBe('data: {"eventMessage":"route-works"}\n\n');

    const invalid = await fetch(`${origin}/logs?device=${DEVICE}&level=fault`);
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("Invalid log level");

    const calls = readFileSync(harness.callsPath, "utf-8").trim().split("\n");
    expect(calls.filter((call) => call.startsWith(`simctl spawn ${DEVICE} `))).toEqual([
      `simctl spawn ${DEVICE} log stream --style ndjson --level debug --predicate processID == 4242`,
    ]);
  }, 30_000);
});
