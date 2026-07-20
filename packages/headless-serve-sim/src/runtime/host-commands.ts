import type { Readable } from "node:stream";

export type CommandChunk = string | Uint8Array;

export type CommandStdio = "capture" | "inherit" | "stream" | { logFile: string; append?: boolean };

interface CommandRequestOptions {
  cwd?: string;
  env?: Readonly<NodeJS.ProcessEnv>;
  input?: CommandChunk;
  stdio?: CommandStdio;
  timeoutMs?: number;
  maxOutputBytes?: number;
  detached?: boolean;
}

export type CommandRequest = CommandRequestOptions &
  (
    | {
        executable: string;
        args?: readonly string[];
        shell?: never;
      }
    | {
        executable?: never;
        args?: never;
        shell: string;
      }
  );

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
}

export interface CommandTask {
  readonly pid: number | undefined;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly result: Promise<CommandResult>;
  stop(signal?: NodeJS.Signals): void;
  unref(): void;
}

export interface HostCommands {
  run(request: CommandRequest): Promise<CommandResult>;
  run(request: CommandRequest, mode: "sync"): CommandResult;
  start(request: CommandRequest): CommandTask;
  signal(pid: number, signal: NodeJS.Signals | 0): boolean;
}

export function commandName(request: CommandRequest): string {
  return request.shell !== undefined
    ? request.shell
    : [request.executable, ...(request.args ?? [])].join(" ");
}
