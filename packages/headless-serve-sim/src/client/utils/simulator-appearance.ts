import type { ExecResult } from "./exec";
import {
  cachedSimulatorSettings,
  confirmSimulatorSetting,
  freshSimulatorSetting,
  patchSimulatorSettings,
} from "./simulator-settings-cache";

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

const toggles = new Map<string, Promise<unknown>>();

/**
 * The toggle the dock, toolbar and ⇧⌘A share. A value the simulator confirmed
 * in the last few seconds is trusted and shown flipped at once; an older one
 * may be stale, so the simulator is asked first. A failed set takes the
 * optimistic value back. Presses queue, so a second one toggles from the
 * first's result rather than racing it.
 */
export function toggleCachedSimulatorAppearance(
  udid: string,
  exec: HostExec,
  onChanged: () => void,
): Promise<"light" | "dark"> {
  const run = async () => {
    const known = freshSimulatorSetting(udid, "appearance");
    const shown = known === "dark" ? "light" : "dark";
    if (known) patchSimulatorSettings(udid, { appearance: shown });
    try {
      const next = await toggleSimulatorAppearance(udid, exec, onChanged, known);
      if (cachedSimulatorSettings(udid)?.appearance !== next)
        patchSimulatorSettings(udid, { appearance: next });
      confirmSimulatorSetting(udid, "appearance", next);
      return next;
    } catch (e) {
      if (known && cachedSimulatorSettings(udid)?.appearance === shown)
        patchSimulatorSettings(udid, { appearance: known });
      throw e;
    }
  };
  // The first press runs at once, so its optimistic change shows this frame.
  const ahead = toggles.get(udid);
  const queued = ahead ? ahead.then(run) : run();
  const settled = queued.catch(() => {});
  toggles.set(udid, settled);
  void settled.then(() => {
    if (toggles.get(udid) === settled) toggles.delete(udid);
  });
  return queued;
}
