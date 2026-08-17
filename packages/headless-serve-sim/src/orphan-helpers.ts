import type { HostCommands } from "./runtime/host-commands";

/** A helper process discovered in the process table. */
export interface RunningHelper {
  pid: number;
  udid: string;
}

/**
 * Helper processes are reaped through their state file: the file names the pid,
 * and a stale entry gets a SIGTERM. That works right up until the file is the
 * thing that goes missing — a crashed parent, a `$TMPDIR` sweep, a manually
 * removed state file — after which the helper is invisible to every cleanup path
 * we have. The next start finds no state, picks the next free port, and spawns
 * another one. Nothing ever removes the first.
 *
 * The cost is not theoretical: a long-lived workstation accumulated 22 orphaned
 * helpers across a handful of simulators, several bound to the SAME device. Each
 * one holds SimulatorKit screen callbacks and a 5 Hz idle timer, so they compete
 * for CPU and for the framebuffer callbacks themselves. Streaming a scrolling
 * app measured 18 fps in that state and 53 fps once they were reaped — same
 * code, same simulator.
 *
 * So the process table, not the state directory, is the source of truth for
 * "is a helper running". These helpers parse it.
 */

/** UDID appearing as the helper's first argument. */
const HELPER_ARG_RE =
  /headless-serve-sim-bin\S*\s+([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i;

/**
 * Parse `ps -A -o pid=,command=` output into helper processes.
 *
 * Deliberately tolerant: anything that is not a helper line is skipped rather
 * than throwing, because this runs on a best-effort cleanup path.
 */
export function parseRunningHelpers(psOutput: string, selfPid?: number): RunningHelper[] {
  const helpers: RunningHelper[] = [];
  for (const line of psOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceAt = trimmed.indexOf(" ");
    if (spaceAt <= 0) continue;
    const pid = Number.parseInt(trimmed.slice(0, spaceAt), 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (selfPid !== undefined && pid === selfPid) continue;
    const command = trimmed.slice(spaceAt + 1);
    const match = HELPER_ARG_RE.exec(command);
    if (!match) continue;
    helpers.push({ pid, udid: match[1]!.toUpperCase() });
  }
  return helpers;
}

/**
 * Helpers that no live state file accounts for.
 *
 * `trackedPids` is every pid named by a state file whose process is alive. A
 * helper missing from that set is unreachable by name and can only be found
 * here, so it is an orphan.
 */
export function selectOrphanHelpers(
  running: readonly RunningHelper[],
  trackedPids: ReadonlySet<number>,
  options: { udid?: string } = {},
): RunningHelper[] {
  const wanted = options.udid?.toUpperCase();
  return running.filter(
    (helper) => !trackedPids.has(helper.pid) && (!wanted || helper.udid === wanted),
  );
}

/** List helper processes currently running, via the process table. */
export function listRunningHelpers(
  hostCommands: HostCommands,
  selfPid = process.pid,
): RunningHelper[] {
  try {
    const result = hostCommands.run(
      { executable: "ps", args: ["-A", "-o", "pid=,command="], stdio: "capture", timeoutMs: 3_000 },
      "sync",
    );
    if (result.exitCode !== 0) return [];
    return parseRunningHelpers(result.stdout.toString(), selfPid);
  } catch {
    return [];
  }
}

/**
 * SIGTERM helpers that no state file accounts for. Returns the pids signalled.
 *
 * Best effort by design — a helper that refuses to die, or one started by
 * another user, must not fail the command the caller was actually running.
 */
export function reapOrphanHelpers(
  hostCommands: HostCommands,
  trackedPids: ReadonlySet<number>,
  options: { udid?: string; selfPid?: number; onReap?: (helper: RunningHelper) => void } = {},
): number[] {
  const running = listRunningHelpers(hostCommands, options.selfPid ?? process.pid);
  const orphans = selectOrphanHelpers(running, trackedPids, { udid: options.udid });
  const reaped: number[] = [];
  for (const orphan of orphans) {
    if (hostCommands.signal(orphan.pid, "SIGTERM")) {
      reaped.push(orphan.pid);
      options.onReap?.(orphan);
    }
  }
  return reaped;
}
