import type { HostCommands } from "./runtime/host-commands";

export async function activeDisplayId(
  host: HostCommands,
  udid: string,
): Promise<`${number}` | undefined> {
  const result = await host.run({
    executable: "xcrun",
    args: [
      "devicectl",
      "device",
      "info",
      "displays",
      "--device",
      udid,
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "5",
    ],
    timeoutMs: 6_000,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.exitCode !== 0 || result.timedOut) return undefined;
  try {
    const data = JSON.parse(result.stdout.toString()) as {
      result?: {
        displays?: Array<{
          displayId?: number;
          active?: boolean;
          backlightState?: string;
          type?: { integrated?: unknown };
        }>;
      };
    };
    const display = data.result?.displays?.find(
      (candidate) =>
        candidate.backlightState === "activeOn" && candidate.type?.integrated !== undefined,
    );
    return display?.displayId && Number.isInteger(display.displayId) && display.displayId > 0
      ? `${display.displayId}`
      : undefined;
  } catch {
    return undefined;
  }
}
