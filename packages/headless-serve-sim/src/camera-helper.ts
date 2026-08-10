import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { STATE_DIR } from "./state";
import type { HostCommands } from "./runtime/host-commands";

/**
 * Talks to a running SimCameraHelper over its UNIX control socket.
 *
 * Split out of the CLI so the preview server can answer camera-status polls
 * itself. The in-page Camera tool used to poll by shelling out to
 * `headless-serve-sim camera status` through /exec, which spawns a whole
 * runtime and CLI per tick — for a probe that is a single line of JSON over an
 * already-open socket.
 */

export const SIMCAM_STATE_DIR = join(STATE_DIR, "simcam");

const HELPER_COMMAND_TIMEOUT_MS = 3000;

export function helperPidFile(udid: string): string {
  return join(SIMCAM_STATE_DIR, `${udid}.pid`);
}

export function helperBundlesFile(udid: string): string {
  return join(SIMCAM_STATE_DIR, `${udid}.bundles.json`);
}

export function helperSocketFile(udid: string): string {
  // POSIX sun_path is 104 chars on macOS — keep this short.
  const short = createHash("sha1").update(udid).digest("hex").slice(0, 12);
  return `/tmp/headless-serve-sim-cam-${short}.sock`;
}

export interface HelperReply {
  ok?: boolean;
  source?: string;
  arg?: string;
  mirror?: string;
  error?: string;
}

export interface InjectedBundlesState {
  helperPid: number;
  bundleIds: string[];
}

/** Status as reported to the CLI and the preview UI. */
export interface CameraStatus {
  udid?: string;
  alive: boolean;
  helperPid?: number | null;
  bundleIds?: string[];
  source?: string;
  arg?: string;
  mirror?: string;
  error?: string;
}

/** Just the signal seam — process signals route through HostCommands. */
export type SignalProbe = Pick<HostCommands, "signal">;

export async function sendHelperCommand(udid: string, cmd: object): Promise<HelperReply> {
  const sockPath = helperSocketFile(udid);
  if (!existsSync(sockPath)) throw new Error("camera helper socket not found");
  const net = await import("net");
  return await new Promise((resolve, reject) => {
    const c = net.createConnection(sockPath);
    let buf = "";
    let settled = false;
    c.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0 && !settled) {
        settled = true;
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(e);
        }
        c.end();
      }
    });
    c.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    c.on("close", () => {
      if (!settled) {
        settled = true;
        reject(new Error("socket closed"));
      }
    });
    c.write(JSON.stringify(cmd) + "\n");
    setTimeout(() => {
      if (!settled) {
        settled = true;
        c.destroy();
        reject(new Error("helper timeout"));
      }
    }, HELPER_COMMAND_TIMEOUT_MS);
  });
}

export function isHelperAlive(udid: string, host: SignalProbe): boolean {
  const pf = helperPidFile(udid);
  if (!existsSync(pf)) return false;
  const pid = Number(readFileSync(pf, "utf-8").trim());
  return Number.isFinite(pid) && host.signal(pid, 0) && existsSync(helperSocketFile(udid));
}

export function readHelperPid(udid: string): number | null {
  try {
    return Number(readFileSync(helperPidFile(udid), "utf-8").trim()) || null;
  } catch {
    return null;
  }
}

export function readInjectedBundles(udid: string): string[] {
  const path = helperBundlesFile(udid);
  if (!existsSync(path)) return [];
  let state: InjectedBundlesState;
  try {
    state = JSON.parse(readFileSync(path, "utf-8")) as InjectedBundlesState;
  } catch {
    return [];
  }
  // Bundles recorded against a previous helper are stale: the injection died
  // with that process even though the file survived.
  const currentHelperPid = readHelperPid(udid);
  if (currentHelperPid == null || state.helperPid !== currentHelperPid) return [];
  return Array.isArray(state.bundleIds) ? state.bundleIds : [];
}

/**
 * Probe a device's camera helper. Never throws — a helper that has a live pid
 * and socket but doesn't answer still reports `alive: true` (with the error
 * attached) so the UI doesn't offer a pointless "inject + relaunch".
 */
export async function cameraStatus(udid: string, host: SignalProbe): Promise<CameraStatus> {
  if (!isHelperAlive(udid, host)) return { udid, alive: false };
  const helperPid = readHelperPid(udid);
  const bundleIds = readInjectedBundles(udid);
  try {
    const reply = await sendHelperCommand(udid, { action: "status" });
    return { udid, alive: true, helperPid, bundleIds, ...reply };
  } catch (e) {
    return {
      udid,
      alive: true,
      helperPid,
      bundleIds,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
