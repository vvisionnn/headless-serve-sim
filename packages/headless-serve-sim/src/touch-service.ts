import type { HostCommands } from "./runtime/host-commands";

/**
 * The helper's touches reach iOS through the simulator's `dthidd` service,
 * which launches on demand — but not for the helper's own HID client, so a
 * simulator where nothing else woke it (a fresh boot, a Duo) ignores every
 * tap. Starting it is a no-op when it already runs. Best effort: a failure
 * here must never block attaching the stream.
 */
export async function ensureTouchService(host: HostCommands, udid: string): Promise<void> {
  try {
    await host.run({
      executable: "xcrun",
      args: ["simctl", "spawn", udid, "launchctl", "start", "com.apple.coredevice.dthidd"],
      stdio: "capture",
      timeoutMs: 5_000,
    });
  } catch {}
}
