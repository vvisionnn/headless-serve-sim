import { createDeviceMotion, DEVICE_ORIENTATIONS, type DeviceOrientation } from "./device-motion";
import { findBootedDevice, resolveDevice } from "./device";
import { createNodeHostCommands } from "./runtime/node-host-commands";

export interface DeviceMotionArgs {
  command: "status" | "angle" | "orientation";
  angle?: number;
  orientation?: DeviceOrientation;
  device?: string;
  json: boolean;
  error?: string;
}

export function parseDeviceMotionArgs(args: string[]): DeviceMotionArgs {
  const rest: string[] = [];
  let device: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") json = true;
    else if (arg === "-d" || arg === "--device") {
      if (!args[i + 1]) return { command: "status", json, error: `${arg} requires a value` };
      device = args[++i];
    } else rest.push(arg);
  }
  const base = { json, ...(device ? { device } : {}) };
  if (rest[0] === "orientation") {
    const orientation = rest[1] as DeviceOrientation;
    if (rest.length !== 2 || !DEVICE_ORIENTATIONS.includes(orientation)) {
      return {
        command: "orientation",
        ...base,
        error: `orientation must be one of ${DEVICE_ORIENTATIONS.join("|")}`,
      };
    }
    return { command: "orientation", orientation, ...base };
  }
  if (rest[0] === "angle") {
    const angle = Number(rest[1]);
    if (
      rest.length !== 2 ||
      !rest[1]?.trim() ||
      !Number.isFinite(angle) ||
      angle < 0 ||
      angle > 180
    ) {
      return {
        command: "angle",
        ...base,
        error: "angle must be a finite number between 0 and 180",
      };
    }
    return { command: "angle", angle, ...base };
  }
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== "status")) {
    return { command: "status", ...base, error: `unknown motion command: ${rest.join(" ")}` };
  }
  return { command: "status", ...base };
}

const USAGE = `Usage: headless-serve-sim motion [status|angle <0..180>|orientation <name>] [-d <device>] [--json]
Orientations: ${DEVICE_ORIENTATIONS.join(" | ")}`;

interface DeviceMotionCliOptions {
  motion?: ReturnType<typeof createDeviceMotion>;
  resolveDevice?: (device?: string) => string | null;
  output?: (text: string) => void;
}

export async function deviceMotionCli(
  args: string[],
  options: DeviceMotionCliOptions = {},
): Promise<void> {
  const output = options.output ?? console.log;
  if (args.includes("-h") || args.includes("--help")) {
    output(USAGE);
    return;
  }
  const parsed = parseDeviceMotionArgs(args);
  if (parsed.error) throw new Error(`${parsed.error}\n${USAGE}`);
  const device = options.resolveDevice
    ? options.resolveDevice(parsed.device)
    : parsed.device
      ? resolveDevice(parsed.device)
      : findBootedDevice();
  if (!device) throw new Error("No booted simulator found. Boot one or pass -d <udid>.");
  const motion = options.motion ?? createDeviceMotion(createNodeHostCommands());
  try {
    if (parsed.command === "angle") await motion.setAngle(device, parsed.angle!);
    else if (parsed.command === "orientation")
      await motion.setOrientation(device, parsed.orientation!);
    const state = await motion.status(device);
    if (parsed.json) output(JSON.stringify(state));
    else {
      output(
        `Hinge angle: ${state.observed.hingeAngle ?? "unavailable"} (commanded: ${state.commanded.hingeAngle ?? "unknown"})`,
      );
      output(`Orientation: ${state.observed.orientation ?? "unavailable"}`);
      output(
        `Active displays: ${
          state.observed.displays
            .filter((display) => display.active)
            .map((display) => display.displayId)
            .join(", ") || "none"
        }`,
      );
      for (const error of state.observed.errors) output(error);
    }
  } finally {
    motion.dispose();
  }
}
