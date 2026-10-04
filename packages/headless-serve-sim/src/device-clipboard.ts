import type { CommandTask, HostCommands } from "./runtime/host-commands";

export interface DeviceClipboard {
  transfer(device: string, direction: "to" | "from"): Promise<void>;
  setSharing(device: string, enabled: boolean): void;
  sharing(device: string): boolean;
  dispose(): void;
}
import { validateSimulatorControlDevice } from "./simulator-controls";

export function createDeviceClipboard(host: HostCommands): DeviceClipboard {
  const tasks = new Map<string, CommandTask>();
  let disposed = false;
  const startSharing = (device: string) => {
    const task = host.start({
      executable: "xcrun",
      args: [
        "devicectl",
        "device",
        "pasteboard",
        "sync-with-host",
        "--device",
        device,
        "--session-timeout",
        "300",
        "--timeout",
        "315",
        "--quiet",
        "--json-output",
        "-",
      ],
      stdio: "capture",
      timeoutMs: 320_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    tasks.set(device, task);
    void task.result
      .then((result) => {
        if (tasks.get(device) !== task) return;
        tasks.delete(device);
        if (result.exitCode === 0 && result.signal === null && !result.timedOut)
          startSharing(device);
      })
      .catch(() => {
        if (tasks.get(device) === task) tasks.delete(device);
      });
  };
  return {
    async transfer(device: string, direction: "to" | "from"): Promise<void> {
      if (disposed) throw new Error("Device clipboard is disposed");
      validateSimulatorControlDevice(device);
      if (direction !== "to" && direction !== "from")
        throw new Error("Invalid clipboard transfer direction");
      const result = await host.run({
        executable: "xcrun",
        args: [
          "devicectl",
          "device",
          "pasteboard",
          "transfer",
          direction,
          "--device",
          device,
          "--data-policy",
          "all-resolved",
          "--quiet",
          "--json-output",
          "-",
        ],
        stdio: "capture",
        timeoutMs: 15_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      if (result.exitCode !== 0 || result.timedOut) throw new Error("Clipboard transfer failed");
    },
    setSharing(device: string, enabled: boolean) {
      if (disposed) throw new Error("Device clipboard is disposed");
      validateSimulatorControlDevice(device);
      if (typeof enabled !== "boolean") throw new Error("Clipboard sharing must be boolean");
      const current = tasks.get(device);
      if (!enabled) {
        tasks.delete(device);
        current?.stop();
        return;
      }
      if (current) return;
      startSharing(device);
    },
    sharing(device: string) {
      return tasks.has(device);
    },
    dispose() {
      disposed = true;
      const active = [...tasks.values()];
      tasks.clear();
      for (const task of active) task.stop();
    },
  };
}
