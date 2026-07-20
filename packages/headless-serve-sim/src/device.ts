import type { HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";

export interface SimctlDeviceInfo {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  deviceTypeIdentifier?: string;
}

export interface SimctlDevicesJson {
  devices: Record<string, SimctlDeviceInfo[]>;
}

export interface DefaultStreamDevice {
  udid: string;
  name: string;
  state: string;
}

export interface DeviceDiscovery {
  findBootedDevice(): string | null;
  pickDefaultStreamDevices(): DefaultStreamDevice[];
  resolveDevice(nameOrUDID: string): string | null;
}

function simctlDevices(host: HostCommands, bootedOnly = false): SimctlDevicesJson {
  const args = ["simctl", "list", "devices"];
  if (bootedOnly) args.push("booted");
  args.push("-j");
  const result = host.run({ executable: "xcrun", args }, "sync");
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || "simctl list devices failed");
  }
  return JSON.parse(result.stdout.toString()) as SimctlDevicesJson;
}

export function createDeviceDiscovery(host: HostCommands): DeviceDiscovery {
  return {
    findBootedDevice(): string | null {
      try {
        const data = simctlDevices(host, true);
        let fallback: string | null = null;
        for (const [runtime, devices] of Object.entries(data.devices)) {
          for (const device of devices) {
            if (device.state !== "Booted") continue;
            if (/iOS/i.test(runtime)) return device.udid;
            fallback ??= device.udid;
          }
        }
        return fallback;
      } catch {
        return null;
      }
    },
    pickDefaultStreamDevices(): DefaultStreamDevice[] {
      try {
        return pickDefaultStreamDevicesFromList(simctlDevices(host));
      } catch {
        return [];
      }
    },
    resolveDevice(nameOrUDID: string): string | null {
      if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(nameOrUDID)) {
        return nameOrUDID;
      }
      try {
        const data = simctlDevices(host);
        for (const runtime of Object.values(data.devices)) {
          for (const device of runtime) {
            if (device.name.toLowerCase() === nameOrUDID.toLowerCase()) return device.udid;
          }
        }
      } catch {}
      return null;
    },
  };
}

const productionDeviceDiscovery = createDeviceDiscovery(createNodeHostCommands());

/**
 * UDID of a booted simulator, or null if none is booted. Prefers an iOS device
 * — a machine may also have a booted watchOS/tvOS sim, which `headless-serve-sim`'s
 * tooling doesn't target.
 */
export function findBootedDevice(): string | null {
  return productionDeviceDiscovery.findBootedDevice();
}

function iosRuntimeVersion(runtime: string): [number, number] {
  const m = runtime.match(/SimRuntime\.iOS-(\d+)-(\d+)/i);
  return [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)];
}

/**
 * Pick the default simulator for a new stream without attaching to a simulator
 * the user already has booted. Returns null if no shutdown iPhone exists; the
 * caller should then ask for an explicit device instead of silently touching a
 * running simulator.
 */
export function pickDefaultStreamDevicesFromList(data: SimctlDevicesJson): DefaultStreamDevice[] {
  const candidates: Array<DefaultStreamDevice & { runtime: string }> = [];
  for (const [runtime, devices] of Object.entries(data.devices)) {
    if (!/SimRuntime\.iOS-/i.test(runtime)) continue;
    for (const device of devices) {
      if (device.isAvailable === false) continue;
      if (device.state !== "Shutdown") continue;
      const isIPhone =
        /^iPhone\b/i.test(device.name) ||
        /SimDeviceType\.iPhone-/i.test(device.deviceTypeIdentifier ?? "");
      if (!isIPhone) continue;
      candidates.push({
        udid: device.udid,
        name: device.name,
        state: device.state,
        runtime,
      });
    }
  }
  candidates.sort((a, b) => {
    const [aMajor, aMinor] = iosRuntimeVersion(a.runtime);
    const [bMajor, bMinor] = iosRuntimeVersion(b.runtime);
    return bMajor - aMajor || bMinor - aMinor || a.name.localeCompare(b.name);
  });
  return candidates.map((picked) => ({
    udid: picked.udid,
    name: picked.name,
    state: picked.state,
  }));
}

export function pickDefaultStreamDeviceFromList(
  data: SimctlDevicesJson,
): DefaultStreamDevice | null {
  return pickDefaultStreamDevicesFromList(data)[0] ?? null;
}

export function pickDefaultStreamDevices(): DefaultStreamDevice[] {
  return productionDeviceDiscovery.pickDefaultStreamDevices();
}

/**
 * Resolve a device name or UDID to a UDID. A UDID is returned as-is; a name is
 * matched case-insensitively against `simctl list devices`. Exits the process
 * with a clear error when the name cannot be resolved.
 */
export function resolveDevice(nameOrUDID: string): string {
  const udid = productionDeviceDiscovery.resolveDevice(nameOrUDID);
  if (udid) return udid;
  console.error(`Could not resolve device: ${nameOrUDID}`);
  process.exit(1);
}
