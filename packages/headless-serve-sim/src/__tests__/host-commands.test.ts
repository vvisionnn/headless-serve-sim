import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createNodeHostCommands } from "../runtime/node-host-commands";
import { createDenyHostCommands } from "../test-support/deny-host-commands";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

describe("scripted host commands", () => {
  test("returns a scripted async result and records the request", async () => {
    const host = createScriptedHostCommands([{ result: { stdout: "booted\n" } }]);
    const request = {
      executable: "xcrun",
      args: ["simctl", "list", "devices", "booted", "-j"],
    } as const;

    const result = await host.run(request);

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
    });
    expect(result.stdout.toString()).toBe("booted\n");
    expect(result.stderr.toString()).toBe("");
    expect(host.calls).toEqual([{ kind: "run", request }]);
  });

  test("denies an unscripted command before starting a process", () => {
    const host = createScriptedHostCommands();

    expect(() => host.start({ executable: "xcrun", args: ["simctl", "boot", "REAL"] })).toThrow(
      "Unscripted host command denied: xcrun simctl boot REAL",
    );
    expect(host.calls).toHaveLength(1);
  });

  test("streams scripted chunks and models probe and signal lifecycle", async () => {
    const host = createScriptedHostCommands([
      {
        pid: 4242,
        stdoutChunks: ["first\n", "second\n"],
        holdUntilStopped: true,
        result: { exitCode: null, signal: "SIGTERM" },
      },
    ]);
    const task = host.start({
      executable: "xcrun",
      args: ["simctl", "spawn", "OWNED", "log", "stream"],
      stdio: "stream",
    });
    const chunks: string[] = [];
    task.stdout?.setEncoding("utf8");
    task.stdout?.on("data", (chunk: string) => chunks.push(chunk));

    await new Promise((resolve) => queueMicrotask(resolve));
    expect(chunks).toEqual(["first\n", "second\n"]);
    expect(host.signal(4242, 0)).toBe(true);

    task.stop();

    expect(await task.result).toMatchObject({ exitCode: null, signal: "SIGTERM" });
    expect(host.signal(4242, 0)).toBe(false);
    expect(host.signals).toEqual([
      { pid: 4242, signal: 0 },
      { pid: 4242, signal: "SIGTERM" },
      { pid: 4242, signal: 0 },
    ]);
  });

  test("probes and signals a seeded persisted process without starting it", () => {
    const host = createScriptedHostCommands([], { alivePids: [9001] });

    expect(host.signal(9001, 0)).toBe(true);
    expect(host.signal(9001, "SIGTERM")).toBe(true);
    expect(host.signal(9001, 0)).toBe(false);
    expect(host.calls).toEqual([]);
  });
});

describe("deny host commands", () => {
  test("fails closed for run, start, signal, and probe", () => {
    const host = createDenyHostCommands("ordinary tests may not execute commands");
    const request = { executable: "xcrun", args: ["simctl", "list"] } as const;

    expect(() => host.run(request)).toThrow("ordinary tests may not execute commands");
    expect(() => host.run(request, "sync")).toThrow("ordinary tests may not execute commands");
    expect(() => host.start(request)).toThrow("ordinary tests may not execute commands");
    expect(() => host.signal(99, 0)).toThrow("ordinary tests may not execute commands");
  });
});

describe("node host commands", () => {
  test("honors the hermetic deny capability before spawn, signal, or probe", () => {
    let spawnCalls = 0;
    let signalCalls = 0;
    const host = createNodeHostCommands({
      environment: { HEADLESS_SERVE_SIM_HOST_COMMANDS: "deny" },
      spawn: (() => {
        spawnCalls++;
      }) as never,
      spawnSync: (() => {
        spawnCalls++;
      }) as never,
      signal: () => {
        signalCalls++;
        return true;
      },
    });
    const request = { executable: "bash", args: ["build.sh"] } as const;

    expect(() => host.run(request)).toThrow("Host command execution is disabled");
    expect(() => host.run(request, "sync")).toThrow("Host command execution is disabled");
    expect(() => host.start(request)).toThrow("Host command execution is disabled");
    expect(() => host.signal(123, 0)).toThrow("Host command execution is disabled");
    expect(spawnCalls).toBe(0);
    expect(signalCalls).toBe(0);
  });

  test("maps a synchronous argv request without using a shell", () => {
    const invocations: unknown[][] = [];
    const host = createNodeHostCommands({
      environment: {},
      spawnSync: ((...args: unknown[]) => {
        invocations.push(args);
        return {
          pid: 123,
          output: [],
          stdout: Buffer.from("ok"),
          stderr: Buffer.alloc(0),
          status: 0,
          signal: null,
          error: undefined,
        };
      }) as never,
    });

    const result = host.run(
      {
        executable: "xcrun",
        args: ["simctl", "list", "devices", "-j"],
        timeoutMs: 2_000,
      },
      "sync",
    );

    expect(result.stdout.toString()).toBe("ok");
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.slice(0, 2)).toEqual(["xcrun", ["simctl", "list", "devices", "-j"]]);
    expect(invocations[0]?.[2]).toMatchObject({
      shell: false,
      timeout: 2_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  test("captures an asynchronous argv process through the same Interface", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: NodeJS.Signals) => boolean;
      unref: () => void;
    };
    child.pid = 456;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.unref = () => {};
    const host = createNodeHostCommands({
      environment: {},
      spawn: (() => {
        queueMicrotask(() => {
          child.stdout.write("out");
          child.stderr.write("warn");
          child.emit("close", 7, null);
        });
        return child;
      }) as never,
    });

    const result = await host.run({ executable: "tool", args: ["arg"] });

    expect(result).toEqual({
      exitCode: 7,
      signal: null,
      stdout: Buffer.from("out"),
      stderr: Buffer.from("warn"),
      timedOut: false,
    });
  });
});
