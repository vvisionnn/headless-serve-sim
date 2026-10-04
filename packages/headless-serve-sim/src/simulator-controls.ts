import type { HostCommands } from "./runtime/host-commands";

export const DEVICE_ORIENTATIONS = [
  "portrait",
  "portraitUpsideDown",
  "landscapeLeft",
  "landscapeRight",
  "faceUp",
  "faceDown",
] as const;
export type DeviceOrientation = (typeof DEVICE_ORIENTATIONS)[number];
export type SimulatorControlOption =
  | "volume"
  | "audio-input"
  | "audio-output"
  | "biometrics-enrolled"
  | "biometric-match"
  | "orientation"
  | "clipboard-send"
  | "clipboard-get"
  | "shared-clipboard"
  | "liquid-glass-opacity";

type AudioDevice = { value: string; label: string };
export interface SimulatorControlState {
  audio: {
    volume: number;
    inputDevice: string;
    outputDevice: string;
    inputDevices: AudioDevice[];
    outputDevices: AudioDevice[];
  } | null;
  biometrics: Array<{ type: string; enabled: boolean }> | null;
  orientation: DeviceOrientation | null;
  sharedClipboard?: boolean;
  appearance?: { liquidGlassOpacity: number } | null;
  inputAttachment?: { appleWindowActive: boolean } | null;
  errors: Partial<
    Record<"audio" | "biometrics" | "orientation" | "appearance" | "inputAttachment", string>
  >;
}

async function devicectl(commands: HostCommands, args: string[]): Promise<Record<string, any>> {
  const result = await commands.run({
    executable: "xcrun",
    args: ["devicectl", ...args, "--quiet", "--json-output", "-", "--timeout", "10"],
    stdio: "capture",
    timeoutMs: 15_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(result.stderr.toString().trim() || "Simulator control command failed");
  }
  const json = JSON.parse(result.stdout.toString()) as { result?: Record<string, any> };
  if (!json.result || typeof json.result !== "object")
    throw new Error("Invalid simulator control response");
  return json.result;
}

function audioOptions(devices: Array<{ uid: string; name: string }>): AudioDevice[] {
  if (
    !Array.isArray(devices) ||
    devices.some((device) => typeof device?.uid !== "string" || typeof device?.name !== "string")
  ) {
    throw new Error("Invalid audio device list");
  }
  return [
    { value: "systemDefault", label: "System Default" },
    ...devices.map((device) => ({ value: device.uid, label: device.name })),
  ];
}

function audioSelection(device: { systemDefault?: {}; device?: { _0: string } }): string {
  if (device?.systemDefault) return "systemDefault";
  if (typeof device?.device?._0 === "string") return device.device._0;
  throw new Error("Invalid audio device selection");
}

export function validateSimulatorControlDevice(device: unknown): asserts device is string {
  if (typeof device !== "string" || !/^[0-9A-Za-z][0-9A-Za-z-]*$/.test(device)) {
    throw new Error("missing or invalid device udid");
  }
}

export async function getSimulatorControlState(
  commands: HostCommands,
  device: string,
): Promise<SimulatorControlState> {
  validateSimulatorControlDevice(device);
  const state: SimulatorControlState = {
    audio: null,
    biometrics: null,
    orientation: null,
    errors: {},
  };
  await Promise.all([
    (async () => {
      try {
        const [audio, devices] = await Promise.all([
          devicectl(commands, ["device", "info", "audio", "--device", device]),
          devicectl(commands, ["list", "audioDevices"]),
        ]);
        if (
          typeof audio.volume !== "number" ||
          !Number.isFinite(audio.volume) ||
          audio.volume < 0 ||
          audio.volume > 100
        ) {
          throw new Error("Invalid device volume");
        }
        state.audio = {
          volume: audio.volume / 100,
          inputDevice: audioSelection(audio.audioInputDevice),
          outputDevice: audioSelection(audio.audioOutputDevice),
          inputDevices: audioOptions(devices.inputDevices),
          outputDevices: audioOptions(devices.outputDevices),
        };
      } catch (error) {
        state.errors.audio = error instanceof Error ? error.message : String(error);
      }
    })(),
    (async () => {
      try {
        const biometrics = await devicectl(commands, [
          "device",
          "settings",
          "biometrics",
          "--device",
          device,
        ]);
        if (
          !Array.isArray(biometrics.biometrics) ||
          biometrics.biometrics.some(
            (item: { type?: unknown; enabled?: unknown }) =>
              typeof item?.type !== "string" || typeof item?.enabled !== "boolean",
          )
        ) {
          throw new Error("Invalid biometric state");
        }
        state.biometrics = biometrics.biometrics;
      } catch (error) {
        state.errors.biometrics = error instanceof Error ? error.message : String(error);
      }
    })(),
    (async () => {
      try {
        const orientation = await devicectl(commands, [
          "device",
          "orientation",
          "get",
          "--device",
          device,
        ]);
        if (!DEVICE_ORIENTATIONS.includes(orientation.deviceOrientation))
          throw new Error("Invalid device orientation state");
        state.orientation = orientation.deviceOrientation;
      } catch (error) {
        state.errors.orientation = error instanceof Error ? error.message : String(error);
      }
    })(),
    (async () => {
      try {
        const appearance = await devicectl(commands, [
          "device",
          "info",
          "appearance",
          "--device",
          device,
        ]);
        if (
          typeof appearance.liquidGlassOpacity !== "number" ||
          !Number.isFinite(appearance.liquidGlassOpacity) ||
          appearance.liquidGlassOpacity < 0 ||
          appearance.liquidGlassOpacity > 1
        ) {
          throw new Error("Invalid Liquid Glass opacity");
        }
        state.appearance = { liquidGlassOpacity: appearance.liquidGlassOpacity };
      } catch (error) {
        state.appearance = null;
        state.errors.appearance = error instanceof Error ? error.message : String(error);
      }
    })(),
    (async () => {
      try {
        const attachment = await commands.run({
          executable: "xcrun",
          args: [
            "simctl",
            "spawn",
            device,
            "notifyutil",
            "-g",
            "com.apple.coredevice.dtuhidd.active",
          ],
          stdio: "capture",
          timeoutMs: 5_000,
          maxOutputBytes: 64 * 1024,
        });
        if (attachment.exitCode !== 0 || attachment.timedOut) {
          throw new Error(attachment.stderr.toString().trim() || "Input attachment query failed");
        }
        const value = attachment.stdout.toString().trim();
        if (
          value !== "com.apple.coredevice.dtuhidd.active 0" &&
          value !== "com.apple.coredevice.dtuhidd.active 1"
        ) {
          throw new Error("Invalid input attachment state");
        }
        state.inputAttachment = {
          appleWindowActive: value === "com.apple.coredevice.dtuhidd.active 1",
        };
      } catch (error) {
        state.inputAttachment = null;
        state.errors.inputAttachment = error instanceof Error ? error.message : String(error);
      }
    })(),
  ]);
  return state;
}

export async function setSimulatorControlSetting(
  commands: HostCommands,
  device: string,
  option: SimulatorControlOption,
  value: unknown,
): Promise<void> {
  validateSimulatorControlDevice(device);
  switch (option) {
    case "volume":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("Volume must be between 0 and 1");
      }
      await devicectl(commands, [
        "device",
        "settings",
        "audio",
        "--device",
        device,
        "--volume",
        String(Math.round(value * 100)),
      ]);
      return;
    case "liquid-glass-opacity":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("Liquid Glass opacity must be between 0 and 1");
      }
      await devicectl(commands, [
        "device",
        "settings",
        "appearance",
        "--device",
        device,
        "--liquid-glass-opacity",
        String(value),
      ]);
      return;
    case "audio-input":
    case "audio-output":
      if (
        typeof value !== "string" ||
        !value ||
        value.startsWith("-") ||
        value.split("").some((character) => character.charCodeAt(0) < 32)
      ) {
        throw new Error("Invalid audio device");
      }
      await devicectl(commands, [
        "device",
        "settings",
        "audio",
        "--device",
        device,
        option === "audio-input" ? "--input-device" : "--output-device",
        value,
      ]);
      return;
    case "biometrics-enrolled":
    case "biometric-match":
      if (typeof value !== "boolean") throw new Error("Biometrics value must be boolean");
      await devicectl(commands, [
        "device",
        option === "biometrics-enrolled" ? "settings" : "simulate",
        "biometrics",
        "--device",
        device,
        option === "biometrics-enrolled"
          ? value
            ? "--enable"
            : "--disable"
          : value
            ? "--success"
            : "--failure",
      ]);
      return;
    case "orientation":
      if (!DEVICE_ORIENTATIONS.includes(value as DeviceOrientation))
        throw new Error("Invalid device orientation");
      await devicectl(commands, [
        "device",
        "orientation",
        "set",
        "--device",
        device,
        value as string,
      ]);
      return;
    default:
      throw new Error("Unknown simulator control option");
  }
}
