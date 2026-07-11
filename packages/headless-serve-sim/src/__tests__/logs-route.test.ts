import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const DEVICE = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
const TOKEN = "logs-route-token";
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createHermeticLogsHarness(): {
  harnessPath: string;
  tmpRoot: string;
  binDir: string;
  callsPath: string;
  cleanupPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "hss-logs-route-"));
  createdDirs.push(root);
  const tmpRoot = join(root, "tmp");
  const stateDir = join(tmpRoot, "headless-serve-sim");
  const binDir = join(root, "bin");
  const callsPath = join(root, "xcrun-calls.log");
  const cleanupPath = join(root, "xcrun-cleanup.log");
  const harnessPath = join(root, "harness.ts");
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
if [ "$1" = "simctl" ] && [ "$2" = "spawn" ]; then
  trap 'printf "%s\\n" cleaned >> "$HSS_LOG_CLEANUP"; exit 0' TERM INT
  printf '{"eventMessage":"route-works"}\\n'
  while :; do sleep 1; done
fi
printf 'unexpected xcrun command: %s\\n' "$*" >&2
exit 1
`,
  );
  chmodSync(xcrunPath, 0o755);

  const middlewarePath = resolve(import.meta.dir, "../middleware.ts");
  writeFileSync(
    harnessPath,
    `import { createServer } from "http";
import { simMiddleware } from ${JSON.stringify(middlewarePath)};

const handler = simMiddleware({ basePath: "/", execToken: ${JSON.stringify(TOKEN)} });
const server = createServer((req, res) => handler(req, res, () => res.end("not found")));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("missing server address");

const controller = new AbortController();
const response = await fetch(
  \`http://127.0.0.1:\${address.port}/logs?device=${DEVICE}&token=${TOKEN}&level=debug\`,
  { signal: controller.signal },
);
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let body = "";
const deadline = Date.now() + 3_000;
while (reader && Date.now() < deadline && !body.includes("route-works")) {
  const result = await reader.read();
  if (result.done) break;
  body += decoder.decode(result.value, { stream: true });
}
controller.abort();
await reader?.cancel().catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 1_200));
server.closeAllConnections?.();
await new Promise<void>((resolve) => server.close(() => resolve()));
console.log(JSON.stringify({ status: response.status, body }));
`,
  );

  return { harnessPath, tmpRoot, binDir, callsPath, cleanupPath };
}

describe("GET /logs", () => {
  test("starts one requested-level stream and terminates it when the client disconnects", () => {
    const harness = createHermeticLogsHarness();
    const result = spawnSync(process.execPath, [harness.harnessPath], {
      cwd: resolve(import.meta.dir, "../../../.."),
      encoding: "utf-8",
      timeout: 10_000,
      env: {
        ...process.env,
        TMPDIR: harness.tmpRoot,
        PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
        HSS_LOG_CALLS: harness.callsPath,
        HSS_LOG_CLEANUP: harness.cleanupPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      status: 200,
      body: ':\n\ndata: {"eventMessage":"route-works"}\n\n',
    });

    const calls = readFileSync(harness.callsPath, "utf-8").trim().split("\n");
    expect(calls.filter((call) => call.startsWith(`simctl spawn ${DEVICE} `))).toEqual([
      `simctl spawn ${DEVICE} log stream --style ndjson --level debug`,
    ]);
    expect(readFileSync(harness.cleanupPath, "utf-8")).toBe("cleaned\n");
  }, 15_000);
});
