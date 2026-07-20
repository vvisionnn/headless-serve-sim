import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
} from "node:child_process";
import { closeSync, openSync } from "node:fs";
import type { Readable } from "node:stream";
import type {
  CommandChunk,
  CommandRequest,
  CommandResult,
  CommandTask,
  HostCommands,
} from "./host-commands";

export interface NodeHostCommandOverrides {
  spawn?: typeof spawn;
  spawnSync?: typeof spawnSync;
  signal?: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  open?: typeof openSync;
  close?: typeof closeSync;
  environment?: Readonly<NodeJS.ProcessEnv>;
}

function buffer(value: string | Uint8Array | null | undefined): Buffer {
  if (value == null) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function target(request: CommandRequest): {
  executable: string;
  args: readonly string[];
  shell: boolean;
} {
  return request.shell !== undefined
    ? { executable: request.shell, args: [], shell: true }
    : { executable: request.executable, args: request.args ?? [], shell: false };
}

function inputBuffer(value: CommandChunk | undefined): Buffer | undefined {
  return value === undefined ? undefined : buffer(value);
}

class NodeHostCommands implements HostCommands {
  readonly #spawn: typeof spawn;
  readonly #spawnSync: typeof spawnSync;
  readonly #signal: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  readonly #open: typeof openSync;
  readonly #close: typeof closeSync;
  readonly #environment: Readonly<NodeJS.ProcessEnv>;

  constructor(overrides: NodeHostCommandOverrides) {
    this.#spawn = overrides.spawn ?? spawn;
    this.#spawnSync = overrides.spawnSync ?? spawnSync;
    this.#signal =
      overrides.signal ??
      ((pid, signal) => {
        try {
          process.kill(pid, signal);
          return true;
        } catch {
          return false;
        }
      });
    this.#open = overrides.open ?? openSync;
    this.#close = overrides.close ?? closeSync;
    this.#environment = overrides.environment ?? process.env;
  }

  run(request: CommandRequest): Promise<CommandResult>;
  run(request: CommandRequest, mode: "sync"): CommandResult;
  run(request: CommandRequest, mode?: "sync"): Promise<CommandResult> | CommandResult {
    this.#assertEnabled();
    if (mode === "sync") return this.#runSync(request);
    return this.start(request).result;
  }

  start(request: CommandRequest): CommandTask {
    this.#assertEnabled();
    const command = target(request);
    const stdioMode = request.stdio ?? "capture";
    let logFd: number | undefined;
    let child: ChildProcess;
    try {
      if (typeof stdioMode === "object") {
        logFd = this.#open(stdioMode.logFile, stdioMode.append ? "a" : "w");
      }
      const stdin =
        request.input === undefined ? (stdioMode === "inherit" ? "inherit" : "ignore") : "pipe";
      const output =
        stdioMode === "capture" || stdioMode === "stream"
          ? "pipe"
          : stdioMode === "inherit"
            ? "inherit"
            : logFd!;
      const options: SpawnOptions = {
        cwd: request.cwd,
        env: request.env as NodeJS.ProcessEnv | undefined,
        detached: request.detached ?? false,
        shell: command.shell,
        stdio: [stdin, output, output],
      };
      child = this.#spawn(command.executable, [...command.args], options);
    } catch (error) {
      if (logFd !== undefined) this.#close(logFd);
      throw error;
    }

    if (request.input !== undefined) child.stdin?.end(inputBuffer(request.input));

    const capture = stdioMode === "capture";
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let rejectResult: (error: unknown) => void = () => {};
    let resolveResult: (result: CommandResult) => void = () => {};

    const result = new Promise<CommandResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (logFd !== undefined) {
        this.#close(logFd);
        logFd = undefined;
      }
    };

    const append = (chunks: Buffer[], chunk: Buffer | string) => {
      if (!capture || settled) return;
      const next = buffer(chunk);
      outputBytes += next.byteLength;
      if (request.maxOutputBytes !== undefined && outputBytes > request.maxOutputBytes) {
        settled = true;
        child.kill("SIGTERM");
        cleanup();
        rejectResult(new Error(`Host command output exceeded ${request.maxOutputBytes} bytes`));
        return;
      }
      chunks.push(next);
    };

    child.stdout?.on("data", (chunk: Buffer | string) => append(stdoutChunks, chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => append(stderrChunks, chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectResult(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult({
        exitCode,
        signal: signal as NodeJS.Signals | null,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut,
      });
    });

    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);
      timer.unref?.();
    }

    return {
      pid: child.pid,
      stdout: child.stdout as Readable | null,
      stderr: child.stderr as Readable | null,
      result,
      stop(signal = "SIGTERM") {
        child.kill(signal);
      },
      unref() {
        child.unref();
      },
    };
  }

  signal(pid: number, signal: NodeJS.Signals | 0): boolean {
    this.#assertEnabled();
    return this.#signal(pid, signal);
  }

  #assertEnabled(): void {
    if (this.#environment.HEADLESS_SERVE_SIM_HOST_COMMANDS === "deny") {
      throw new Error(
        "Host command execution is disabled by HEADLESS_SERVE_SIM_HOST_COMMANDS=deny",
      );
    }
  }

  #runSync(request: CommandRequest): CommandResult {
    const command = target(request);
    const stdioMode = request.stdio ?? "capture";
    let logFd: number | undefined;
    try {
      if (typeof stdioMode === "object") {
        logFd = this.#open(stdioMode.logFile, stdioMode.append ? "a" : "w");
      }
      const stdin =
        request.input === undefined ? (stdioMode === "inherit" ? "inherit" : "ignore") : "pipe";
      const output =
        stdioMode === "capture" || stdioMode === "stream"
          ? "pipe"
          : stdioMode === "inherit"
            ? "inherit"
            : logFd!;
      const options: SpawnSyncOptions = {
        cwd: request.cwd,
        env: request.env as NodeJS.ProcessEnv | undefined,
        shell: command.shell,
        stdio: [stdin, output, output],
        input: inputBuffer(request.input),
        timeout: request.timeoutMs,
        maxBuffer: request.maxOutputBytes,
      };
      const completed = this.#spawnSync(command.executable, [...command.args], options);
      const timedOut =
        completed.error !== undefined &&
        "code" in completed.error &&
        completed.error.code === "ETIMEDOUT";
      if (completed.error && !timedOut) throw completed.error;
      return {
        exitCode: completed.status,
        signal: completed.signal as NodeJS.Signals | null,
        stdout: buffer(completed.stdout),
        stderr: buffer(completed.stderr),
        timedOut,
      };
    } finally {
      if (logFd !== undefined) this.#close(logFd);
    }
  }
}

export function createNodeHostCommands(overrides: NodeHostCommandOverrides = {}): HostCommands {
  return new NodeHostCommands(overrides);
}
