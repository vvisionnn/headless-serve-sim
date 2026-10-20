import type { ExecResult } from "./exec";

export type HostExec = (command: string) => Promise<ExecResult>;

function commandError(action: string, result: ExecResult): Error {
  return new Error(result.stderr.trim() || result.stdout.trim() || `${action} failed`);
}

/**
 * Set the opposite appearance. When the caller already knows the current one
 * it's a single exec; otherwise it's read from the simulator first.
 */
export async function toggleSimulatorAppearance(
  udid: string,
  exec: HostExec,
  onChanged: () => void,
  known?: string,
): Promise<"light" | "dark"> {
  let current = known;
  if (current !== "light" && current !== "dark") {
    const read = await exec(`xcrun simctl ui ${udid} appearance`);
    if (read.exitCode !== 0) throw commandError("Reading simulator appearance", read);
    current = read.stdout.trim();
  }

  const next = current === "dark" ? "light" : "dark";
  const changed = await exec(`xcrun simctl ui ${udid} appearance ${next}`);
  if (changed.exitCode !== 0) throw commandError("Setting simulator appearance", changed);

  onChanged();
  return next;
}
