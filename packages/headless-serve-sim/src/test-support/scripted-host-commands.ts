import { PassThrough } from "node:stream";
import type {
  CommandChunk,
  CommandRequest,
  CommandResult,
  CommandTask,
  HostCommands,
} from "../runtime/host-commands";

export interface ScriptedCommand {
  pid?: number;
  stdoutChunks?: readonly CommandChunk[];
  stderrChunks?: readonly CommandChunk[];
  holdUntilStopped?: boolean;
  result?: Partial<Omit<CommandResult, "stdout" | "stderr">> & {
    stdout?: CommandChunk;
    stderr?: CommandChunk;
  };
}

export interface HostCommandCall {
  kind: "run" | "run-sync" | "start";
  request: CommandRequest;
}

export interface HostSignalCall {
  pid: number;
  signal: NodeJS.Signals | 0;
}

export interface ScriptedHostCommands extends HostCommands {
  readonly calls: HostCommandCall[];
  readonly signals: HostSignalCall[];
  readonly remaining: number;
}

export interface ScriptedHostCommandOptions {
  alivePids?: readonly number[];
}

function bytes(value: CommandChunk | undefined): Buffer {
  if (value === undefined) return Buffer.alloc(0);
  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function resultFor(step: ScriptedCommand): CommandResult {
  return {
    exitCode: step.result?.exitCode ?? 0,
    signal: step.result?.signal ?? null,
    stdout: bytes(step.result?.stdout),
    stderr: bytes(step.result?.stderr),
    timedOut: step.result?.timedOut ?? false,
  };
}

export function createScriptedHostCommands(
  initialSteps: readonly ScriptedCommand[] = [],
  options: ScriptedHostCommandOptions = {},
): ScriptedHostCommands {
  const steps = [...initialSteps];
  const calls: HostCommandCall[] = [];
  const signals: HostSignalCall[] = [];
  const processes = new Map<number, (signal: NodeJS.Signals) => void>();
  for (const pid of options.alivePids ?? []) {
    processes.set(pid, () => processes.delete(pid));
  }

  const takeStep = (request: CommandRequest): ScriptedCommand => {
    const step = steps.shift();
    if (!step) {
      const target =
        "shell" in request
          ? request.shell
          : [request.executable, ...(request.args ?? [])].join(" ");
      throw new Error(`Unscripted host command denied: ${target}`);
    }
    return step;
  };

  const run = ((request: CommandRequest, mode?: "sync"): Promise<CommandResult> | CommandResult => {
    calls.push({ kind: mode === "sync" ? "run-sync" : "run", request });
    const result = resultFor(takeStep(request));
    return mode === "sync" ? result : Promise.resolve(result);
  }) as HostCommands["run"];

  const host: ScriptedHostCommands = {
    calls,
    signals,
    get remaining() {
      return steps.length;
    },
    run,
    start(request: CommandRequest): CommandTask {
      calls.push({ kind: "start", request });
      const step = takeStep(request);
      const scriptedResult = resultFor(step);
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let settled = false;
      let resolveResult: (result: CommandResult) => void = () => {};
      const result = new Promise<CommandResult>((resolve) => {
        resolveResult = resolve;
      });
      const finish = (signal = scriptedResult.signal) => {
        if (settled) return;
        settled = true;
        if (step.pid !== undefined) processes.delete(step.pid);
        stdout.end();
        stderr.end();
        resolveResult({
          ...scriptedResult,
          signal,
          exitCode: signal === null ? scriptedResult.exitCode : null,
        });
      };
      if (step.pid !== undefined) {
        processes.set(step.pid, (signal) => finish(signal));
      }
      queueMicrotask(() => {
        for (const chunk of step.stdoutChunks ?? [scriptedResult.stdout]) stdout.write(chunk);
        for (const chunk of step.stderrChunks ?? [scriptedResult.stderr]) stderr.write(chunk);
        if (!step.holdUntilStopped) finish();
      });
      return {
        pid: step.pid,
        stdout,
        stderr,
        result,
        stop(signal = "SIGTERM") {
          if (step.pid === undefined) finish(signal);
          else host.signal(step.pid, signal);
        },
        unref() {},
      };
    },
    signal(pid: number, signal: NodeJS.Signals | 0): boolean {
      signals.push({ pid, signal });
      const finish = processes.get(pid);
      if (!finish) return false;
      if (signal !== 0) finish(signal);
      return true;
    },
  };
  return host;
}
