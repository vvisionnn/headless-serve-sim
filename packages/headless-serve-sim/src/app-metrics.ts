import { execFileSync } from "child_process";

// Live per-app resource sampling. iOS Simulator apps are ordinary macOS host
// processes (children of launchd_sim, sharing the host PID namespace), so once
// we have the foreground app's host PID — already surfaced by the /appstate SSE
// — we can read its CPU% and resident memory straight from `ps`, no simctl in
// the hot path. CPU is derived as a delta of cumulative CPU-time between polls
// (what `top`/pidusage do internally); `ps`'s own %cpu is a lifetime average
// and barely moves, so it's unusable for a live readout.

interface ProcSample {
  rssKb: number;
  cpuSeconds: number;
}

export interface AppMetrics {
  pid: number;
  alive: boolean;
  rssBytes: number | null;
  /** Instantaneous CPU %, normalized to one core (>100 on multi-threaded load).
   *  null until a second sample lands (the delta needs two readings). */
  cpuPercent: number | null;
}

export type ProcReader = (pid: number) => ProcSample | null;

// Parse `ps -o time=`/`cputime=` cumulative CPU time into seconds. macOS emits
// "MM:SS.cc" with unbounded minutes; also tolerate "HH:MM:SS" and "DD-HH:MM:SS".
export function parseCpuTimeToSeconds(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let days = 0;
  let rest = s;
  const dash = s.indexOf("-");
  if (dash !== -1) {
    days = Number(s.slice(0, dash));
    rest = s.slice(dash + 1);
    if (!Number.isFinite(days)) return null;
  }
  const parts = rest.split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    seconds = seconds * 60 + n;
  }
  return days * 86400 + seconds;
}

// Pure: CPU% from two cumulative-CPU-time readings. null when priming (no prev)
// or when the counter went backwards (PID reused for a different process).
export function computeCpuPercent(
  prev: { cpuSeconds: number; atMs: number } | undefined,
  curr: { cpuSeconds: number; atMs: number },
): number | null {
  if (!prev) return null;
  const wallSeconds = (curr.atMs - prev.atMs) / 1000;
  if (wallSeconds <= 0) return null;
  const cpuDelta = curr.cpuSeconds - prev.cpuSeconds;
  if (cpuDelta < 0) return null;
  return (cpuDelta / wallSeconds) * 100;
}

function readProcWithPs(pid: number): ProcSample | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "rss=,time="], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    if (!out) return null;
    const m = out.match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const rssKb = Number(m[1]);
    const cpuSeconds = parseCpuTimeToSeconds(m[2]!);
    if (!Number.isFinite(rssKb) || cpuSeconds == null) return null;
    return { rssKb, cpuSeconds };
  } catch {
    // Non-zero exit = process gone / invalid pid.
    return null;
  }
}

// CPU-time history per PID, so successive ~1Hz polls yield an instantaneous
// rate. Single-viewer dev tool: keyed by PID only; pruned to bound growth as
// foreground apps churn.
const cpuHistory = new Map<number, { cpuSeconds: number; atMs: number }>();
const HISTORY_TTL_MS = 30_000;

export function sampleAppMetrics(
  pid: number,
  nowMs: number,
  read: ProcReader = readProcWithPs,
): AppMetrics {
  const proc = read(pid);
  if (!proc) {
    cpuHistory.delete(pid);
    return { pid, alive: false, rssBytes: null, cpuPercent: null };
  }
  const curr = { cpuSeconds: proc.cpuSeconds, atMs: nowMs };
  const cpuPercent = computeCpuPercent(cpuHistory.get(pid), curr);
  cpuHistory.set(pid, curr);
  for (const [key, value] of cpuHistory) {
    if (nowMs - value.atMs > HISTORY_TTL_MS) cpuHistory.delete(key);
  }
  return { pid, alive: true, rssBytes: proc.rssKb * 1024, cpuPercent };
}
