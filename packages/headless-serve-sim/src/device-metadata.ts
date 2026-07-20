import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { loadInstalledDeviceFrameSpecAsync } from "./device-frame-profile";
import type { HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";

export const DEVICE_METADATA_RETRY_MS = 5_000;

export interface SimulatorDeviceMetadata {
  udid: string;
  name: string;
  deviceTypeIdentifier?: string;
}

export interface DeviceMetadata {
  deviceName: string;
  deviceTypeIdentifier?: string;
  deviceFrameSpec?: DeviceFrameSpec;
}

export interface DeviceMetadataSource {
  findSimulator: (udid: string) => Promise<SimulatorDeviceMetadata | null | undefined>;
  loadDeviceFrameSpec: (deviceTypeIdentifier: string) => Promise<DeviceFrameSpec | null>;
}

export function createDeviceMetadataResolver(
  source: DeviceMetadataSource,
  options: { now?: () => number } = {},
): { resolve: (udid: string) => Promise<DeviceMetadata | undefined> } {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: DeviceMetadata; expiresAt: number }>();
  const pending = new Map<string, Promise<DeviceMetadata | undefined>>();

  const resolve = (udid: string): Promise<DeviceMetadata | undefined> => {
    const cached = cache.get(udid);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);

    const inFlight = pending.get(udid);
    if (inFlight) return inFlight;

    const load = (async (): Promise<DeviceMetadata | undefined> => {
      let simulator: SimulatorDeviceMetadata | null | undefined;
      try {
        simulator = await source.findSimulator(udid);
      } catch {
        return undefined;
      }
      if (!simulator) return undefined;

      let deviceFrameSpec: DeviceFrameSpec | null = null;
      if (simulator.deviceTypeIdentifier) {
        try {
          deviceFrameSpec = await source.loadDeviceFrameSpec(simulator.deviceTypeIdentifier);
        } catch {}
      }

      const value: DeviceMetadata = {
        deviceName: simulator.name,
        ...(simulator.deviceTypeIdentifier
          ? { deviceTypeIdentifier: simulator.deviceTypeIdentifier }
          : {}),
        ...(deviceFrameSpec ? { deviceFrameSpec } : {}),
      };
      cache.set(udid, {
        value,
        expiresAt: deviceFrameSpec?.artwork
          ? Number.POSITIVE_INFINITY
          : now() + DEVICE_METADATA_RETRY_MS,
      });
      return value;
    })();
    pending.set(udid, load);
    const clearPending = () => {
      if (pending.get(udid) === load) pending.delete(udid);
    };
    void load.then(clearPending, clearPending);
    return load;
  };

  return { resolve };
}

async function findInstalledSimulator(
  host: HostCommands,
  udid: string,
): Promise<SimulatorDeviceMetadata | undefined> {
  try {
    const result = await host.run({
      executable: "xcrun",
      args: ["simctl", "list", "devices", "-j"],
      timeoutMs: 3_000,
    });
    if (result.exitCode !== 0) return undefined;
    const output = result.stdout.toString();
    const devices = JSON.parse(output) as {
      devices?: Record<
        string,
        Array<{
          udid?: unknown;
          name?: unknown;
          isAvailable?: unknown;
          deviceTypeIdentifier?: unknown;
        }>
      >;
    };
    for (const [runtime, candidates] of Object.entries(devices.devices ?? {})) {
      if (!/SimRuntime\.(iOS|watchOS|visionOS|xrOS)-/i.test(runtime)) continue;
      for (const candidate of candidates) {
        if (candidate.udid !== udid || candidate.isAvailable === false) continue;
        if (typeof candidate.name !== "string") return undefined;
        return {
          udid,
          name: candidate.name,
          ...(typeof candidate.deviceTypeIdentifier === "string"
            ? { deviceTypeIdentifier: candidate.deviceTypeIdentifier }
            : {}),
        };
      }
    }
  } catch {}
  return undefined;
}

export function createInstalledDeviceMetadataSource(
  host: HostCommands,
  loadDeviceFrameSpec: DeviceMetadataSource["loadDeviceFrameSpec"] = loadInstalledDeviceFrameSpecAsync,
): DeviceMetadataSource {
  return {
    findSimulator: (udid) => findInstalledSimulator(host, udid),
    loadDeviceFrameSpec,
  };
}

const installedDeviceMetadataResolver = createDeviceMetadataResolver(
  createInstalledDeviceMetadataSource(createNodeHostCommands()),
);

/** Resolve selected simulator metadata without blocking HTTP/SSE request handling. */
export function resolveInstalledDeviceMetadata(udid: string): Promise<DeviceMetadata | undefined> {
  return installedDeviceMetadataResolver.resolve(udid);
}
