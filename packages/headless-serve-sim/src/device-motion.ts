import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirnameOf } from "./runtime";
import type { CommandTask, HostCommands } from "./runtime/host-commands";
import { resolveNativeSourceRoot } from "./native-source-root";

const __dirname = dirnameOf(import.meta.url);
const TOOL_NAME = "headless-serve-sim-device-motion";

export function locateDeviceMotionTool(): string | null {
  const candidates = [
    join(__dirname, "..", "dist", "simmotion", TOOL_NAME),
    join(__dirname, "simmotion", TOOL_NAME),
    join(__dirname, "..", "..", "headless-serve-sim-binary", "dist", "simmotion", TOOL_NAME),
  ];
  for (const path of candidates) if (existsSync(path)) return resolve(path);
  return null;
}

export const DEVICE_ORIENTATIONS = [
  "portrait",
  "portraitUpsideDown",
  "landscapeLeft",
  "landscapeRight",
  "faceUp",
  "faceDown",
] as const;
export type DeviceOrientation = (typeof DEVICE_ORIENTATIONS)[number];
export type ConsumerHIDPhase = "down" | "up" | "press";

export function isConsumerHIDEvent(usagePage: unknown, usage: unknown, phase: unknown): boolean {
  return (
    usagePage === 12 &&
    typeof usage === "number" &&
    Number.isInteger(usage) &&
    usage >= 0 &&
    usage <= 0xffff &&
    (phase === "down" || phase === "up" || phase === "press")
  );
}

export function isKeyboardHIDEvent(usage: unknown, phase: unknown): boolean {
  return (
    typeof usage === "number" &&
    Number.isInteger(usage) &&
    usage >= 0 &&
    usage <= 0xff &&
    (phase === "down" || phase === "up")
  );
}

export interface DeviceMotionState {
  commanded: {
    hingeAngle: number | null;
    orientation: DeviceOrientation | null;
    pose: string | null;
  };
  observed: {
    hingeAngle: number | null;
    hingeAngleAgeMs: number | null;
    orientation: string | null;
    nonFlatOrientation: string | null;
    orientationLocked: boolean | null;
    displays: Record<string, unknown>[];
    source: "iohid+devicectl";
    errors: string[];
  };
}

interface DeviceMotionOptions {
  locateTool?: () => string | null;
  buildScript?: string;
  onBuild?: () => void;
}

interface NativeReply {
  id: number;
  ok: boolean;
  error?: string;
  commandedAngle: number | null;
  observedAngle: number | null;
  observedAgeMs: number | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function motionSession(task: CommandTask, onExit: () => void) {
  if (!task.stdin || !task.stdout) {
    task.stop();
    throw new Error("device-motion helper requires interactive stdin and stdout");
  }
  const input = task.stdin;
  let nextId = 0;
  let buffer = "";
  let closed: Error | null = null;
  let pending: {
    id: number;
    result: ReturnType<typeof deferred<NativeReply>>;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let writing: Promise<void> | null = null;
  let reading: Promise<NativeReply> | null = null;
  let readingDone: Promise<void> | null = null;
  let queued: { angle: number; result: ReturnType<typeof deferred<void>> } | null = null;

  const fail = (error: Error) => {
    closed = error;
    if (pending) {
      clearTimeout(pending.timer);
      pending.result.reject(error);
      pending = null;
    }
    if (queued) {
      queued.result.reject(error);
      queued = null;
    }
  };
  task.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > 64 * 1024) {
      fail(new Error("device-motion helper response exceeded limit"));
      task.stop();
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let reply: NativeReply;
      try {
        reply = JSON.parse(line) as NativeReply;
      } catch {
        fail(new Error("device-motion helper returned invalid JSON"));
        task.stop();
        return;
      }
      if (!pending || reply.id !== pending.id) continue;
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      if (reply.ok) current.result.resolve(reply);
      else current.result.reject(new Error(reply.error || "device-motion command failed"));
    }
  });
  input.on("error", (error) => fail(error));
  task.result.then(
    (result) => {
      fail(new Error(result.stderr.toString().trim() || "device-motion helper exited"));
      onExit();
    },
    (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
      onExit();
    },
  );

  const request = (command: Record<string, unknown>): Promise<NativeReply> => {
    if (closed) return Promise.reject(closed);
    if (pending) return Promise.reject(new Error("device-motion command already in flight"));
    const id = ++nextId;
    const result = deferred<NativeReply>();
    const timer = setTimeout(() => {
      fail(new Error("device-motion helper timed out"));
      task.stop();
    }, 5000);
    pending = { id, result, timer };
    input.write(`${JSON.stringify({ id, ...command })}\n`);
    return result.promise;
  };

  const writeAngle = (angle: number): Promise<void> => {
    const work = (readingDone ?? Promise.resolve())
      .then(() => request({ command: "angle", angle }))
      .then(() => {});
    writing = work;
    void work
      .finally(() => {
        writing = null;
        const next = queued;
        queued = null;
        if (next) writeAngle(next.angle).then(next.result.resolve, next.result.reject);
      })
      .catch(() => {});
    return work;
  };

  const writeCommand = async (command: Record<string, unknown>): Promise<void> => {
    while (writing || readingDone) await (writing ?? readingDone)!.catch(() => {});
    const work = request(command).then(() => {});
    writing = work;
    try {
      await work;
    } finally {
      writing = null;
      const next = queued;
      queued = null;
      if (next) writeAngle(next.angle).then(next.result.resolve, next.result.reject);
    }
  };

  return {
    setAngle(angle: number): Promise<void> {
      if (!writing) return writeAngle(angle);
      if (queued) queued.angle = angle;
      else queued = { angle, result: deferred<void>() };
      return queued.result.promise;
    },
    setOrientation(orientation: DeviceOrientation): Promise<void> {
      return writeCommand({ command: "orientation", orientation });
    },
    sendKey(usage: number, phase: "down" | "up"): Promise<void> {
      return writeCommand({ command: "key", usage, phase });
    },
    sendConsumer(usagePage: number, usage: number, phase: ConsumerHIDPhase): Promise<void> {
      return writeCommand({ command: "consumer", usagePage, usage, phase });
    },
    async status(): Promise<NativeReply> {
      if (reading) return reading;
      while (writing) await writing;
      if (reading) return reading;
      reading = request({ command: "status" });
      readingDone = reading
        .then(
          () => {},
          () => {},
        )
        .then(() => {
          reading = null;
          readingDone = null;
        });
      return reading;
    },
    dispose() {
      fail(new Error("device-motion disposed"));
      task.stop();
    },
  };
}

export function createDeviceMotion(host: HostCommands, options: DeviceMotionOptions = {}) {
  const sessions = new Map<string, Promise<ReturnType<typeof motionSession>>>();
  const commanded = new Map<string, DeviceMotionState["commanded"]>();
  const orientationCommands = new Map<
    string,
    { revision: number; pending: number; sentAt: number }
  >();
  const commandState = (udid: string): DeviceMotionState["commanded"] => {
    let state = commanded.get(udid);
    if (!state) {
      state = { hingeAngle: null, orientation: null, pose: null };
      commanded.set(udid, state);
    }
    return state;
  };
  const locate = options.locateTool ?? locateDeviceMotionTool;
  const sourceRoot = resolveNativeSourceRoot(__dirname);
  const buildScript =
    options.buildScript ?? (sourceRoot && join(sourceRoot, "SimDeviceMotion", "build.sh"));
  let toolPromise: Promise<string> | null = null;
  let disposed = false;

  const tool = (): Promise<string> => {
    toolPromise ??= (async () => {
      const found = locate();
      if (found) return found;
      if (!buildScript || !existsSync(buildScript))
        throw new Error("device-motion helper not found; reinstall a recent release");
      options.onBuild?.();
      const result = await host.run({
        executable: "bash",
        args: [buildScript, join(__dirname, "..", "dist", "simmotion")],
        stdio: "capture",
      });
      if (result.exitCode !== 0 || result.timedOut)
        throw new Error(result.stderr.toString().trim() || "device-motion helper build failed");
      const built = locate();
      if (!built) throw new Error("Build succeeded but device-motion helper not found");
      return built;
    })();
    void toolPromise.catch(() => {
      toolPromise = null;
    });
    return toolPromise;
  };

  const session = (udid: string) => {
    let current = sessions.get(udid);
    if (!current) {
      current = tool().then((binary) => {
        if (disposed) throw new Error("device-motion disposed");
        return motionSession(
          host.start({
            executable: "xcrun",
            args: ["simctl", "spawn", udid, binary],
            interactive: true,
            stdio: "stream",
          }),
          () => {
            if (sessions.get(udid) === current) sessions.delete(udid);
          },
        );
      });
      sessions.set(udid, current);
      void current.catch(() => {
        sessions.delete(udid);
      });
    }
    return current;
  };

  const runDevice = async (args: string[]) => {
    const result = await host.run({
      executable: "xcrun",
      args: ["devicectl", "device", ...args, "--quiet", "--json-output", "-", "--timeout", "5"],
      stdio: "capture",
      timeoutMs: 6500,
      maxOutputBytes: 1024 * 1024,
    });
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(result.stderr.toString().trim() || "device state query failed");
    return JSON.parse(result.stdout.toString()) as { result: Record<string, unknown> };
  };

  return {
    async sendKey(udid: string, usage: number, phase: "down" | "up"): Promise<void> {
      if (!isKeyboardHIDEvent(usage, phase)) throw new Error("Invalid keyboard HID event");
      if (disposed) throw new Error("device-motion disposed");
      await (await session(udid)).sendKey(usage, phase);
    },
    async sendConsumer(
      udid: string,
      usagePage: number,
      usage: number,
      phase: ConsumerHIDPhase,
    ): Promise<void> {
      if (!isConsumerHIDEvent(usagePage, usage, phase))
        throw new Error("Invalid consumer HID event");
      if (disposed) throw new Error("device-motion disposed");
      await (await session(udid)).sendConsumer(usagePage, usage, phase);
    },
    async setOrientation(udid: string, orientation: DeviceOrientation): Promise<void> {
      if (!DEVICE_ORIENTATIONS.includes(orientation))
        throw new Error(`unknown orientation: ${orientation}`);
      if (disposed) throw new Error("device-motion disposed");
      const state = orientationCommands.get(udid) ?? { revision: 0, pending: 0, sentAt: 0 };
      orientationCommands.set(udid, state);
      state.revision++;
      state.pending++;
      try {
        await (await session(udid)).setOrientation(orientation);
        commandState(udid).orientation = orientation;
        state.sentAt = Date.now();
      } finally {
        state.pending--;
      }
    },
    async status(udid: string): Promise<DeviceMotionState> {
      const observed: DeviceMotionState["observed"] = {
        hingeAngle: null,
        hingeAngleAgeMs: null,
        orientation: null,
        nonFlatOrientation: null,
        orientationLocked: null,
        displays: [],
        source: "iohid+devicectl",
        errors: [],
      };
      const orientationRevision = orientationCommands.get(udid)?.revision ?? 0;
      const orientationPending = (orientationCommands.get(udid)?.pending ?? 0) > 0;
      const results = await Promise.allSettled([
        (async () => {
          const data = await runDevice(["info", "displays", "--device", udid]);
          observed.displays = Array.isArray(data.result.displays) ? data.result.displays : [];
        })(),
        (async () => {
          const { result: orientation } = await runDevice(["orientation", "get", "--device", udid]);
          observed.orientation =
            typeof orientation.deviceOrientation === "string"
              ? orientation.deviceOrientation
              : null;
          observed.nonFlatOrientation =
            typeof orientation.deviceOrientationNonFlat === "string"
              ? orientation.deviceOrientationNonFlat
              : null;
          observed.orientationLocked =
            typeof orientation.deviceIsOrientationLocked === "boolean"
              ? orientation.deviceIsOrientationLocked
              : null;
          if (
            DEVICE_ORIENTATIONS.includes(observed.orientation as DeviceOrientation) &&
            !orientationPending &&
            !(orientationCommands.get(udid)?.pending ?? 0) &&
            orientationRevision === (orientationCommands.get(udid)?.revision ?? 0) &&
            (observed.orientation === commandState(udid).orientation ||
              Date.now() - (orientationCommands.get(udid)?.sentAt ?? 0) >= 2000)
          )
            commandState(udid).orientation = null;
        })(),
        (async () => {
          const reply = await (await session(udid)).status();
          if (typeof reply.observedAngle === "number" && Number.isFinite(reply.observedAngle))
            observed.hingeAngle = reply.observedAngle;
          if (typeof reply.observedAgeMs === "number" && Number.isFinite(reply.observedAgeMs))
            observed.hingeAngleAgeMs = reply.observedAgeMs;
          if (observed.hingeAngle === null)
            throw new Error(
              "Hinge angle sensor readback is unavailable; commanded angle is not observed state.",
            );
        })(),
      ]);
      for (const result of results) {
        if (result.status === "rejected")
          observed.errors.push(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
      }
      return { commanded: { ...commandState(udid) }, observed };
    },
    async setAngle(udid: string, angle: number): Promise<void> {
      if (!Number.isFinite(angle) || angle < 0 || angle > 180)
        throw new Error("angle must be a finite number between 0 and 180");
      if (disposed) throw new Error("device-motion disposed");
      await (await session(udid)).setAngle(angle);
      commandState(udid).hingeAngle = angle;
    },
    dispose() {
      disposed = true;
      for (const pending of sessions.values())
        void pending.then((current) => current.dispose()).catch(() => {});
      sessions.clear();
    },
  };
}
