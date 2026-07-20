import type { ExecResult } from "./exec";

export type HostExec = (command: string) => Promise<ExecResult>;

function commandError(action: string, result: ExecResult): Error {
  return new Error(result.stderr.trim() || result.stdout.trim() || `${action} failed`);
}

export async function toggleSimulatorAppearance(
  udid: string,
  exec: HostExec,
  onChanged: () => void,
): Promise<"light" | "dark"> {
  const current = await exec(`xcrun simctl ui ${udid} appearance`);
  if (current.exitCode !== 0) throw commandError("Reading simulator appearance", current);

  const next = current.stdout.trim() === "dark" ? "light" : "dark";
  const changed = await exec(`xcrun simctl ui ${udid} appearance ${next}`);
  if (changed.exitCode !== 0) throw commandError("Setting simulator appearance", changed);

  onChanged();
  return next;
}
