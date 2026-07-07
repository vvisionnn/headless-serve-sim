import { execSync } from "child_process";

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

/**
 * UDID of a booted simulator, or null if none is booted. Prefers an iOS device
 * — a machine may also have a booted watchOS/tvOS sim, which `headless-serve-sim`'s
 * tooling doesn't target.
 */
export function findBootedDevice(): string | null {
  try {
    const output = execSync("xcrun simctl list devices booted -j", { encoding: "utf-8" });
    const data = JSON.parse(output) as {
      devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
    };
    let fallback: string | null = null;
    for (const [runtime, devices] of Object.entries(data.devices)) {
      for (const device of devices) {
        if (device.state !== "Booted") continue;
        if (/iOS/i.test(runtime)) return device.udid;
        fallback ??= device.udid;
      }
    }
    return fallback;
  } catch {}
  return null;
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

export function pickDefaultStreamDeviceFromList(data: SimctlDevicesJson): DefaultStreamDevice | null {
  return pickDefaultStreamDevicesFromList(data)[0] ?? null;
}

export function pickDefaultStreamDevices(): DefaultStreamDevice[] {
  try {
    const output = execSync("xcrun simctl list devices -j", { encoding: "utf-8" });
    return pickDefaultStreamDevicesFromList(JSON.parse(output) as SimctlDevicesJson);
  } catch {}
  return [];
}

/**
 * Pick a shutdown iPhone on the newest available iOS runtime. This is the
 * streaming default used when the user did not pass a device.
 */
export function pickDefaultStreamDevice(): DefaultStreamDevice | null {
  return pickDefaultStreamDevices()[0] ?? null;
}

/**
 * Resolve a device name or UDID to a UDID. A UDID is returned as-is; a name is
 * matched case-insensitively against `simctl list devices`. Exits the process
 * with a clear error when the name cannot be resolved.
 */
export function resolveDevice(nameOrUDID: string): string {
  if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(nameOrUDID)) {
    return nameOrUDID;
  }
  try {
    const output = execSync("xcrun simctl list devices -j", { encoding: "utf-8" });
    const data = JSON.parse(output) as {
      devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
    };
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.name.toLowerCase() === nameOrUDID.toLowerCase()) return device.udid;
      }
    }
  } catch {}
  console.error(`Could not resolve device: ${nameOrUDID}`);
  process.exit(1);
}
