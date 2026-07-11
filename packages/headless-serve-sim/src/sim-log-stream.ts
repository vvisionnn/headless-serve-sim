import { spawn, type ChildProcess } from "child_process";
import type { ServerResponse } from "http";

export const SIM_LOG_LEVELS = ["default", "info", "debug"] as const;
export type SimLogLevel = (typeof SIM_LOG_LEVELS)[number];

export function parseSimLogLevel(value: string | null | undefined): SimLogLevel | null {
  if (value == null) return "info";
  return (SIM_LOG_LEVELS as readonly string[]).includes(value)
    ? value as SimLogLevel
    : null;
}

export function parseSimLogProcessId(
  value: string | null | undefined,
): number | null | undefined {
  if (value == null) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const processId = Number(value);
  return Number.isSafeInteger(processId) && processId > 0
    ? processId
    : undefined;
}

export function buildSimLogStreamArgs(
  udid: string,
  level: SimLogLevel,
  processId: number | null = null,
): string[] {
  const args = [
    "simctl",
    "spawn",
    udid,
    "log",
    "stream",
    "--style",
    "ndjson",
    "--level",
    level,
  ];
  if (processId !== null) args.push("--predicate", `processID == ${processId}`);
  return args;
}

export interface SimLogLineFramer {
  push(chunk: string): string[];
}

export function createSimLogLineFramer(maxLineLength = 1024 * 1024): SimLogLineFramer {
  let buffer = "";
  let discardingOversizedLine = false;

  return {
    push(chunk: string): string[] {
      const lines: string[] = [];
      buffer += chunk;

      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);

        if (discardingOversizedLine) {
          discardingOversizedLine = false;
          continue;
        }

        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line.length > 0 && line.length <= maxLineLength) lines.push(line);
      }

      if (buffer.length > maxLineLength) {
        buffer = "";
        discardingOversizedLine = true;
      }

      return lines;
    },
  };
}

export interface StartSimulatorLogStreamOptions {
  udid: string;
  level: SimLogLevel;
  processId?: number | null;
  response: Pick<ServerResponse, "write" | "end" | "once" | "writableEnded">;
  spawnProcess?: typeof spawn;
  maxLineLength?: number;
  maxPendingBytes?: number;
}

export function startSimulatorLogStream({
  udid,
  level,
  processId = null,
  response,
  spawnProcess = spawn,
  maxLineLength,
  maxPendingBytes = 1024 * 1024,
}: StartSimulatorLogStreamOptions): () => void {
  const child: ChildProcess = spawnProcess(
    "xcrun",
    buildSimLogStreamArgs(udid, level, processId),
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const stdout = child.stdout;
  const framer = createSimLogLineFramer(maxLineLength);
  let stopped = false;
  let waitingForDrain = false;
  const pendingPayloads: Array<{ value: string; bytes: number }> = [];
  let pendingBytes = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stdout?.destroy();
    child.kill();
  };

  const endResponse = () => {
    if (!response.writableEnded) response.end();
  };

  const flush = () => {
    while (!stopped && !waitingForDrain && pendingPayloads.length > 0) {
      const payload = pendingPayloads.shift()!;
      pendingBytes -= payload.bytes;
      if (response.write(payload.value)) continue;

      waitingForDrain = true;
      stdout?.pause();
      response.once("drain", () => {
        waitingForDrain = false;
        if (stopped) return;
        flush();
        if (!waitingForDrain) stdout?.resume();
      });
    }
  };

  stdout?.setEncoding("utf8");
  stdout?.on("data", (chunk: Buffer | string) => {
    if (stopped) return;
    const lines = framer.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (lines.length === 0) return;
    const payload = lines.map((line) => `data: ${line}\n\n`).join("");
    const bytes = Buffer.byteLength(payload);
    if (bytes > maxPendingBytes) return;
    while (pendingPayloads.length > 0 && pendingBytes + bytes > maxPendingBytes) {
      pendingBytes -= pendingPayloads.shift()!.bytes;
    }
    pendingPayloads.push({ value: payload, bytes });
    pendingBytes += bytes;
    flush();
  });

  child.once("error", () => {
    endResponse();
    stop();
  });
  child.once("close", () => {
    endResponse();
    if (!stopped) {
      stopped = true;
      stdout?.destroy();
    }
  });

  return stop;
}
