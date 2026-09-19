import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createSimMiddleware } from "../middleware";
import type { CommandRequest, CommandResult, HostCommands } from "../runtime/host-commands";

const DEVICE = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
const TOKEN = "logs-route-token";
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function result(stdout = ""): CommandResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    timedOut: false,
  };
}

function createLogHost(): {
  hostCommands: HostCommands;
  requests: CommandRequest[];
  stops: () => number;
} {
  const requests: CommandRequest[] = [];
  let stopCount = 0;
  const hostCommands = {
    run(request: CommandRequest, mode?: "sync") {
      requests.push(request);
      const value = result(
        JSON.stringify({
          devices: {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [{ udid: DEVICE, state: "Booted" }],
          },
        }),
      );
      return mode === "sync" ? value : Promise.resolve(value);
    },
    start(request: CommandRequest) {
      requests.push(request);
      const stdout = new PassThrough();
      queueMicrotask(() => stdout.write('{"eventMessage":"route-works"}\n'));
      return {
        pid: 100,
        stdout,
        stderr: null,
        result: new Promise<CommandResult>(() => {}),
        stop() {
          stopCount++;
          stdout.destroy();
        },
        unref() {},
      };
    },
    signal(pid: number, signal: NodeJS.Signals | 0) {
      return pid === process.pid && signal === 0;
    },
  } as HostCommands;
  return { hostCommands, requests, stops: () => stopCount };
}

describe("GET /logs", () => {
  test.each(["logs", "appstate", "ax"])(
    "does not start /%s resources after disconnect during inventory lookup",
    async (route) => {
      const stateDir = mkdtempSync(join(tmpdir(), "hss-aborted-stream-"));
      createdDirs.push(stateDir);
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
      const pending = Promise.withResolvers<CommandResult>();
      const started = Promise.withResolvers<void>();
      const harness = createLogHost();
      harness.hostCommands.run = (() => {
        started.resolve();
        return pending.promise;
      }) as unknown as HostCommands["run"];
      const handler = createSimMiddleware(harness.hostCommands, {
        basePath: "/",
        execToken: TOKEN,
        serveSimBin: "test-cli",
        stateDir,
      });
      const request = Object.assign(new EventEmitter(), {
        url: `/${route}?device=${DEVICE}&token=${TOKEN}`,
        headers: {},
        aborted: false,
      });
      const response = Object.assign(new EventEmitter(), {
        destroyed: false,
        writableEnded: false,
        writeHead: mock(() => {}),
        write: mock(() => {}),
      });
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 503 }),
      );
      try {
        handler(request as IncomingMessage, response as unknown as ServerResponse);
        await started.promise;
        request.aborted = true;
        response.destroyed = true;
        request.emit("close");
        pending.resolve(
          result(JSON.stringify({ devices: { iOS: [{ udid: DEVICE, state: "Booted" }] } })),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(harness.requests).toEqual([]);
        expect(response.writeHead).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        response.writableEnded = true;
        request.emit("close");
        fetchSpy.mockRestore();
      }
    },
  );

  test("starts one requested-level stream and terminates it when the client disconnects", async () => {
    const root = mkdtempSync(join(tmpdir(), "hss-logs-route-"));
    createdDirs.push(root);
    const stateDir = join(root, "state");
    mkdirSync(stateDir);
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
    const harness = createLogHost();
    const handler = createSimMiddleware(harness.hostCommands, {
      basePath: "/",
      execToken: TOKEN,
      serveSimBin: "test-headless-serve-sim",
      stateDir,
    });
    const server = createServer((req, res) => handler(req, res, () => res.end("not found")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const controller = new AbortController();
      const response = await fetch(
        `http://127.0.0.1:${port}/logs?device=${DEVICE}&token=${TOKEN}&level=debug&processId=4242`,
        { signal: controller.signal },
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let body = "";
      while (!body.includes("route-works")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value, { stream: true });
      }
      controller.abort();
      await reader.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response.status).toBe(200);
      expect(body).toBe(':\n\ndata: {"eventMessage":"route-works"}\n\n');
      expect(harness.requests).toEqual([
        {
          executable: "xcrun",
          args: ["simctl", "list", "devices", "booted", "-j"],
          stdio: "capture",
          timeoutMs: 3000,
          maxOutputBytes: undefined,
        },
        {
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
      ]);
      expect(harness.stops()).toBe(1);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});
