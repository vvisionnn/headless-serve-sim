#!/usr/bin/env node
import { Command } from "commander";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { homedir, networkInterfaces } from "os";
import { join, resolve } from "path";
import { STATE_DIR, stateFileForDevice, listStateFiles } from "./state";
import { textToKeyEvents, UnsupportedCharacterError, sendKeyEventsToWs } from "./text-to-keys";
import { dirnameOf, sleepSync, isPortFree, servePreview } from "./runtime";
import { findBootedDevice, pickDefaultStreamDevices, resolveDevice } from "./device";
import { document } from "./document-import";
import { permissions } from "./permissions";
import { statusBar } from "./status-bar";
import { userDefaults } from "./user-defaults";
import { uiSettings } from "./ui-settings";
import { appActions } from "./app-actions";
import { screenshot } from "./screenshot";
import { cameraShmNameForUdid } from "./camera-shm-name";
import { debugCli, debugHelper, debugState } from "./debug";
import type { CommandRequest, CommandResult, CommandTask } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";
import { resolveUnembeddedHelperBinary } from "./helper-binary";
import { resolveNativeSourceRoot } from "./native-source-root";

// `import.meta.dir` is Bun-only; resolve once via fileURLToPath so the bundled
// CLI works under plain `node` too.
const __dirname = dirnameOf(import.meta.url);
const hostCommands = createNodeHostCommands();

class HostCommandFailure extends Error {
  readonly stderr: string;

  constructor(result: CommandResult, fallback: string) {
    const stderr = result.stderr.toString().trim();
    super(stderr || fallback);
    this.name = "HostCommandFailure";
    this.stderr = stderr;
  }
}

function runHostSync(request: CommandRequest, fallback: string): Buffer {
  const result = hostCommands.run(request, "sync");
  if (result.exitCode !== 0) throw new HostCommandFailure(result, fallback);
  return result.stdout;
}

const permissionsDependencies = {
  host: hostCommands,
  findBootedDevice,
  resolveDevice,
  simulatorLibraryDir: (udid: string) =>
    join(homedir(), "Library", "Developer", "CoreSimulator", "Devices", udid, "data", "Library"),
  writeStdout: (message: string) => console.log(message),
  writeStderr: (message: string) => console.error(message),
  now: Date.now,
  sleep: sleepSync,
};

// Embed the Swift helper so `bun build --compile` produces a self-contained
// `headless-serve-sim` binary. In dev / the un-compiled ESM bin the returned path is a
// real file on disk; inside a compiled binary it points at bun's virtual FS
// and we extract the bytes to a cached location on first use.
import swiftHelperEmbeddedPath from "../../headless-serve-sim-binary/bin/headless-serve-sim-bin" with { type: "file" };

interface ServerState {
  pid: number;
  port: number;
  device: string;
  url: string;
  streamUrl: string;
  wsUrl: string;
  headed: boolean;
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function readState(udid?: string): ServerState | null {
  if (udid) {
    return readStateFile(stateFileForDevice(udid));
  }
  // No udid: return the first live device state
  for (const file of listStateFiles()) {
    const state = readStateFile(file);
    if (state) return state;
  }
  return null;
}

/**
 * Snapshot simctl's boot state once per `readStateFile` batch. A full
 * `simctl list devices -j` is ~50ms; doing it per-state multiplied the cost
 * by the number of running helpers. We cache for 1 second so a flurry of
 * readStateFile() calls (e.g. readAllStates loop) shares one lookup.
 */
let bootedSnapshot: { at: number; booted: Set<string> | null } = { at: 0, booted: null };
function getBootedUdids(): Set<string> | null {
  const now = Date.now();
  if (bootedSnapshot.booted && now - bootedSnapshot.at < 1000) {
    return bootedSnapshot.booted;
  }
  try {
    const output = runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "list", "devices", "booted", "-j"],
        timeoutMs: 3_000,
      },
      "simctl list devices failed",
    );
    const data = JSON.parse(output.toString()) as {
      devices: Record<string, Array<{ udid: string; state: string }>>;
    };
    const booted = new Set<string>();
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.state === "Booted") booted.add(device.udid);
      }
    }
    bootedSnapshot = { at: now, booted };
    return booted;
  } catch {
    // simctl lookup failed (Xcode offline, etc.) — we can't prove the device
    // is shutdown, so don't treat as stale. Returns null so caller skips the
    // booted check for this invocation.
    return null;
  }
}

function readStateFile(file: string): ServerState | null {
  try {
    if (!existsSync(file)) {
      debugState("state file missing %s", file);
      return null;
    }
    const state = JSON.parse(readFileSync(file, "utf-8")) as ServerState;
    try {
      if (!hostCommands.signal(state.pid, 0)) throw new Error("helper is not running");
    } catch {
      // Helper process is gone — drop the file.
      debugState("helper pid %d dead, removing stale state %s", state.pid, file);
      unlinkSync(file);
      return null;
    }
    // The helper is alive, but the simulator it was bound to may have been
    // shut down (Simulator.app quit, machine slept, `simctl shutdown`, etc.).
    // When that happens the helper keeps accepting /stream.mjpeg connections
    // but never emits frames, so clients hang on "Connecting...". Detect and
    // recycle here so --detach / --list always return a working stream.
    const booted = getBootedUdids();
    if (booted && !booted.has(state.device)) {
      debugState(
        "helper pid %d bound to non-booted device %s — killing stale helper",
        state.pid,
        state.device,
      );
      console.error(
        `[headless-serve-sim] Helper pid ${state.pid} is bound to device ${state.device} which is no longer booted — killing stale helper.`,
      );
      hostCommands.signal(state.pid, "SIGTERM");
      try {
        unlinkSync(file);
      } catch {}
      return null;
    }
    debugState("state ok pid=%d device=%s port=%d", state.pid, state.device, state.port);
    return state;
  } catch (err) {
    debugState("readStateFile threw for %s: %o", file, err);
    return null;
  }
}

function readAllStates(): ServerState[] {
  const states: ServerState[] = [];
  for (const file of listStateFiles()) {
    const state = readStateFile(file);
    if (state) states.push(state);
  }
  return states;
}

function writeState(state: ServerState) {
  ensureStateDir();
  writeFileSync(stateFileForDevice(state.device), JSON.stringify(state, null, 2));
  debugState("wrote state pid=%d device=%s port=%d", state.pid, state.device, state.port);
}

function makeServerState(pid: number, port: number, device: string, headed: boolean): ServerState {
  const host = "127.0.0.1";
  return {
    pid,
    port,
    device,
    url: `http://${host}:${port}`,
    streamUrl: `http://${host}:${port}/stream.mjpeg`,
    wsUrl: `ws://${host}:${port}/ws`,
    headed,
  };
}

function clearState(udid?: string) {
  if (udid) {
    debugState("clearState device=%s", udid);
    try {
      unlinkSync(stateFileForDevice(udid));
    } catch {}
  } else {
    debugState("clearState (all)");
    for (const file of listStateFiles()) {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
}

function findHelperBinary(): string {
  const isEmbedded = swiftHelperEmbeddedPath.startsWith("/$bunfs/");

  if (!isEmbedded) {
    const helper = resolveUnembeddedHelperBinary(__dirname);
    if (helper) return helper;
    throw new Error(
      `headless-serve-sim-bin not found or not executable. Run 'bun run build:swift' first.\nChecked beside ${__dirname} and in the native workspace package.`,
    );
  }

  // Compiled `bun --compile` binary: extract embedded bytes to a cache dir
  // keyed by content hash so updates replace the previous extraction.
  const bytes = readFileSync(swiftHelperEmbeddedPath);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const cacheDir = resolve(homedir(), "Library/Caches/headless-serve-sim");
  mkdirSync(cacheDir, { recursive: true });
  const extracted = resolve(cacheDir, `headless-serve-sim-bin-${hash}`);
  if (!existsSync(extracted)) {
    writeFileSync(extracted, bytes);
    chmodSync(extracted, 0o755);
    // Re-apply ad-hoc signature so the macOS kernel will exec it.
    try {
      runHostSync(
        {
          executable: "codesign",
          args: ["-s", "-", "-f", extracted],
        },
        "codesign failed",
      );
    } catch {}
  }
  return extracted;
}

/**
 * Env to spawn the Swift helper with. The helper links SimulatorKit/CoreSimulator
 * via `@rpath`, but the rpath baked in at build time points at whatever Xcode
 * lived on the build machine (e.g. `/Applications/Xcode_16.4.app/...`). On any
 * machine with Xcode installed at a different path that lookup fails with
 * `dyld: Library not loaded: @rpath/SimulatorKit.framework`. Inject the user's
 * actual Xcode PrivateFrameworks dir so dyld can resolve it regardless.
 */
function helperSpawnEnv(): NodeJS.ProcessEnv {
  let dev: string | null = null;
  try {
    dev = runHostSync(
      {
        executable: "xcode-select",
        args: ["-p"],
      },
      "xcode-select failed",
    )
      .toString()
      .trim();
  } catch {}
  if (!dev) return process.env;
  const fw = `${dev}/Library/PrivateFrameworks`;
  return {
    ...process.env,
    DYLD_FRAMEWORK_PATH: process.env.DYLD_FRAMEWORK_PATH
      ? `${fw}:${process.env.DYLD_FRAMEWORK_PATH}`
      : fw,
  };
}

// ─── Device helpers ───

function getDeviceName(udid: string): string | null {
  try {
    const output = runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "list", "devices", "-j"],
      },
      "simctl list devices failed",
    );
    const data = JSON.parse(output.toString()) as {
      devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
    };
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.udid === udid) return device.name;
      }
    }
  } catch {}
  return null;
}

function isDeviceBooted(udid: string): boolean {
  try {
    const output = runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "list", "devices", "-j"],
      },
      "simctl list devices failed",
    );
    const data = JSON.parse(output.toString()) as {
      devices: Record<string, Array<{ udid: string; state: string }>>;
    };
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.udid === udid) return device.state === "Booted";
      }
    }
  } catch {}
  return false;
}

function isProcessAlive(pid: number): boolean {
  return hostCommands.signal(pid, 0);
}

/** Kill a process and wait for it to actually exit. */
function stopProcess(pid: number): void {
  if (!hostCommands.signal(pid, "SIGTERM")) return;
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (!hostCommands.signal(pid, 0)) return;
    sleepSync(25);
  }
  hostCommands.signal(pid, "SIGKILL");
  const deadline2 = Date.now() + 500;
  while (Date.now() < deadline2) {
    if (!hostCommands.signal(pid, 0)) return;
    sleepSync(25);
  }
}

/**
 * Return PIDs currently *listening* on a TCP port (excluding ourselves).
 *
 * The LISTEN filter is load-bearing: a bare `lsof -ti tcp:<port>` also lists
 * processes holding *client* sockets to the port — most notably the user's
 * browser streaming MJPEG from a previous helper. Killing those SIGKILLs the
 * browser's network process, which aborts every in-flight fetch in the new
 * preview tab and surfaces as "Stream is not producing frames".
 */
function getPortHolders(port: number): number[] {
  try {
    const output = runHostSync(
      {
        executable: "lsof",
        args: ["-ti", `tcp:${port}`, "-sTCP:LISTEN"],
      },
      "lsof failed",
    )
      .toString()
      .trim();
    if (!output) return [];
    const myPid = process.pid;
    return output
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((pid) => Number.isFinite(pid) && pid !== myPid);
  } catch {
    return [];
  }
}

/** Kill whatever process is holding a given port. Logs the PIDs being killed. */
function killPortHolder(port: number): void {
  const pids = getPortHolders(port);
  if (pids.length === 0) return;
  console.log(`\x1b[90mPort ${port} busy, killing listener pid(s): ${pids.join(", ")}\x1b[0m`);
  for (const pid of pids) {
    hostCommands.signal(pid, "SIGKILL");
  }
  sleepSync(100);
}

function bootDevice(udid: string, headed: boolean): void {
  if (!isDeviceBooted(udid)) {
    try {
      runHostSync(
        {
          executable: "xcrun",
          args: ["simctl", "boot", udid],
        },
        `simctl boot ${udid} failed`,
      );
    } catch (err: any) {
      const msg = (err.stderr ?? err.message ?? "").toLowerCase();
      if (!msg.includes("booted") && !msg.includes("current state")) {
        throw new Error(`Failed to boot device ${udid}: ${err.stderr || err.message}`);
      }
    }
  }
  if (!headed) return;
  // Launch Simulator.app's GUI window. `-g` keeps it backgrounded; the short
  // timeout avoids hanging on headless hosts where `open` waits forever for a
  // window server that never arrives.
  try {
    runHostSync(
      {
        executable: "open",
        args: ["-ga", "Simulator"],
        timeoutMs: 3_000,
      },
      "open Simulator failed",
    );
  } catch {}
}

function shutdownDeviceQuietly(udid: string): void {
  try {
    runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "shutdown", udid],
        timeoutMs: 30_000,
      },
      `simctl shutdown ${udid} failed`,
    );
  } catch {}
}

function getLocalNetworkIP(): string | null {
  const interfaces = networkInterfaces();
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

async function findAvailablePort(start: number): Promise<number> {
  const usedPorts = new Set(readAllStates().map((s) => s.port));
  for (let port = start; port < start + 100; port++) {
    if (usedPorts.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No available port found in range ${start}-${start + 99}`);
}

async function ensureBooted(udid: string, headed: boolean): Promise<void> {
  bootDevice(udid, headed);
  await waitForBootReady(udid);
}

async function requireAlreadyBooted(udid: string): Promise<void> {
  if (!isDeviceBooted(udid)) {
    throw new Error(`Device ${udid} is not booted; waiting for the user to boot it.`);
  }
  await waitForBootReady(udid);
}

async function waitForBootReady(udid: string): Promise<void> {
  // `simctl bootstatus -b` blocks until the device's services are actually ready
  // (not just flipped to "Booted"). Much more reliable than polling `simctl list`.
  try {
    runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "bootstatus", udid, "-b"],
        timeoutMs: 60_000,
      },
      `simctl bootstatus ${udid} failed`,
    );
  } catch (err: any) {
    if (!isDeviceBooted(udid)) {
      throw new Error(`Device ${udid} failed to reach booted state: ${err.stderr || err.message}`);
    }
  }
}

// ─── Helper spawn ───

interface SpawnHelperOptions {
  helperPath: string;
  udid: string;
  port: number;
  host: string;
  logFile: string;
}

/** Wait for the helper to become ready (health check + capture started). */
async function waitForHelperReady(
  pid: number,
  url: string,
  logFile: string,
  isAlive: () => boolean,
): Promise<{ ready: boolean; log: string }> {
  let ready = false;
  const startedAt = Date.now();
  debugHelper("waitForHelperReady pid=%d url=%s", pid, url);

  // Poll /health
  for (let i = 0; i < 30; i++) {
    if (!isAlive()) {
      debugHelper("helper pid=%d died during /health polling (attempt %d)", pid, i);
      break;
    }
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        ready = true;
        debugHelper("helper pid=%d /health ok after %dms", pid, Date.now() - startedAt);
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!ready) {
    debugHelper("helper pid=%d /health never responded (%dms)", pid, Date.now() - startedAt);
  }

  if (ready) {
    // Wait for capture to start or process to exit
    const captureStartedAt = Date.now();
    const captureDeadline = captureStartedAt + 8_000;
    let captureSawStart = false;
    while (Date.now() < captureDeadline) {
      await new Promise((r) => setTimeout(r, 200));
      if (!isAlive()) {
        debugHelper("helper pid=%d died while awaiting Capture started", pid);
        ready = false;
        break;
      }
      try {
        const log = readFileSync(logFile, "utf-8");
        if (log.includes("Capture started")) {
          captureSawStart = true;
          debugHelper(
            "helper pid=%d saw 'Capture started' after %dms",
            pid,
            Date.now() - captureStartedAt,
          );
          break;
        }
      } catch {}
    }
    if (ready && !captureSawStart) {
      debugHelper(
        "helper pid=%d ready but never logged 'Capture started' within %dms — stream may not produce frames",
        pid,
        Date.now() - captureStartedAt,
      );
    }
  }

  let log = "";
  try {
    log = readFileSync(logFile, "utf-8").trim();
  } catch {}
  return { ready, log };
}

/** Spawn the helper detached (for --detach mode). Returns after readiness check. */
async function spawnHelperDetached(opts: SpawnHelperOptions): Promise<{
  ready: boolean;
  pid: number;
  exited: boolean;
  log: string;
}> {
  const { helperPath, udid, port, host, logFile } = opts;
  const url = `http://${host}:${port}`;

  ensureStateDir();
  const child = hostCommands.start({
    executable: helperPath,
    args: [udid, "--port", String(port)],
    detached: true,
    stdio: { logFile },
    env: helperSpawnEnv(),
  });
  child.unref();

  const childPid = child.pid!;
  let childExited = false;
  void child.result.then(
    () => {
      childExited = true;
    },
    () => {
      childExited = true;
    },
  );

  const { ready, log } = await waitForHelperReady(
    childPid,
    url,
    logFile,
    () => !childExited && isProcessAlive(childPid),
  );

  return { ready, pid: childPid, exited: childExited || !isProcessAlive(childPid), log };
}

/** Spawn the helper attached (for foreground follow mode). Returns the child process. */
async function spawnHelperAttached(opts: SpawnHelperOptions): Promise<{
  ready: boolean;
  child: CommandTask;
  log: string;
}> {
  const { helperPath, udid, port, host, logFile } = opts;
  const url = `http://${host}:${port}`;

  ensureStateDir();
  const child = hostCommands.start({
    executable: helperPath,
    args: [udid, "--port", String(port)],
    detached: false,
    stdio: { logFile },
    env: helperSpawnEnv(),
  });

  const childPid = child.pid!;
  let childExited = false;
  void child.result.then(
    () => {
      childExited = true;
    },
    () => {
      childExited = true;
    },
  );

  const { ready, log } = await waitForHelperReady(
    childPid,
    url,
    logFile,
    () => !childExited && isProcessAlive(childPid),
  );

  return { ready, child, log };
}

/** Boot + spawn helper with retry logic. Returns pid on success, throws on failure. */
async function startHelper(
  udid: string,
  port: number,
  opts: { detach: boolean; headed: boolean; attachOnly?: boolean },
): Promise<{ pid: number; child?: CommandTask }> {
  debugHelper(
    "startHelper udid=%s port=%d detach=%s headed=%s",
    udid,
    port,
    opts.detach,
    opts.headed,
  );
  if (opts.attachOnly) await requireAlreadyBooted(udid);
  else await ensureBooted(udid, opts.headed);

  const host = "127.0.0.1";
  const helperPath = findHelperBinary();
  const logFile = join(STATE_DIR, `server-${udid}.log`);
  debugHelper("helper binary=%s logFile=%s", helperPath, logFile);
  const spawnOpts: SpawnHelperOptions = { helperPath, udid, port, host, logFile };

  let lastLog = "";
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    debugHelper("spawn attempt %d/%d", attempt, MAX_ATTEMPTS);
    killPortHolder(port);

    if (opts.detach) {
      const result = await spawnHelperDetached(spawnOpts);
      debugHelper(
        "spawnHelperDetached result ready=%s pid=%d exited=%s",
        result.ready,
        result.pid,
        result.exited,
      );
      if (result.ready) {
        writeState(makeServerState(result.pid, port, udid, opts.headed));
        return { pid: result.pid };
      }
      stopProcess(result.pid);
      lastLog = result.log;
    } else {
      const result = await spawnHelperAttached(spawnOpts);
      debugHelper("spawnHelperAttached result ready=%s pid=%d", result.ready, result.child.pid);
      if (result.ready) {
        writeState(makeServerState(result.child.pid!, port, udid, opts.headed));
        return { pid: result.child.pid!, child: result.child };
      }
      stopProcess(result.child.pid!);
      lastLog = result.log;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const reason = lastLog ? `Helper failed:\n${lastLog}` : "Helper process failed to start";
  throw new Error(reason);
}

// ─── Commands ───

/** Foreground follow mode (default). Stays attached, cleans up on Ctrl+C. */
async function follow(devices: string[], startPort: number, quiet: boolean, headed: boolean) {
  debugCli("follow devices=%o startPort=%d headed=%s", devices, startPort, headed);
  const existingDefault = devices.length === 0 ? readState() : null;
  const defaultCandidates =
    devices.length > 0 || existingDefault ? null : pickDefaultStreamDevices();
  const udids =
    devices.length > 0
      ? devices.map(resolveDevice)
      : existingDefault
        ? [existingDefault.device]
        : (defaultCandidates ?? []).map((candidate) => candidate.udid);
  if (devices.length === 0 && udids.length === 0) {
    console.error(
      "No device specified and no shutdown iPhone simulator found. Pass a device explicitly to stream a booted simulator.",
    );
    process.exit(1);
  }

  const children = new Map<string, CommandTask>();
  const states: ServerState[] = [];
  let port = startPort;

  for (let index = 0; index < udids.length; index++) {
    const udid = udids[index]!;
    const defaultCandidate = defaultCandidates?.find((candidate) => candidate.udid === udid);
    // Return existing server if already running
    const existing = readState(udid);
    if (existing) {
      if (!quiet) {
        const name = getDeviceName(udid) ?? udid;
        if (udids.length > 1) console.log(`\n==> ${name} (${udid}) <==`);
        console.log(`  Already running on port ${existing.port}`);
        console.log(`  Stream:    ${existing.streamUrl}`);
        console.log(`  WebSocket: ${existing.wsUrl}`);
      }
      states.push(existing);
      if (defaultCandidates) break;
      continue;
    }

    port = await findAvailablePort(port);
    if (defaultCandidate && !quiet) {
      console.log(
        `Booting isolated simulator ${defaultCandidate.name} (${defaultCandidate.udid})...`,
      );
    }
    let started: { pid: number; child?: CommandTask };
    try {
      started = await startHelper(udid, port, { detach: false, headed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (defaultCandidates) {
        if (!quiet) {
          console.error(`Skipping ${defaultCandidate?.name ?? udid}: ${message}`);
        }
        shutdownDeviceQuietly(udid);
        continue;
      }
      console.error(message);
      process.exit(1);
    }
    const { pid, child } = started;

    if (child) {
      children.set(udid, child);
    }

    const state = makeServerState(pid, port, udid, headed);
    states.push(state);

    if (!quiet) {
      const name = getDeviceName(udid) ?? udid;
      if (udids.length > 1) console.log(`\n==> ${name} (${udid}) <==`);
      console.log(`  Stream:    ${state.streamUrl}`);
      console.log(`  WebSocket: ${state.wsUrl}`);
      console.log(`  Port:      ${port}`);
    }

    port++;
    if (defaultCandidates) break;
  }

  if (defaultCandidates && states.length === 0) {
    console.error(
      "No shutdown iPhone simulator could be booted. Pass a device explicitly to stream a booted simulator.",
    );
    process.exit(1);
  }

  // Machine-readable JSON to stdout
  if (states.length === 1) {
    const s = states[0]!;
    console.log(
      JSON.stringify({
        url: s.url,
        streamUrl: s.streamUrl,
        wsUrl: s.wsUrl,
        port: s.port,
        device: s.device,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        devices: states.map((s) => ({
          url: s.url,
          streamUrl: s.streamUrl,
          wsUrl: s.wsUrl,
          port: s.port,
          device: s.device,
        })),
      }),
    );
  }

  // If no new children were spawned (all already running), exit
  if (children.size === 0) return;

  let shuttingDown = false;

  const cleanup = (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!quiet) console.log("\nShutting down...");
    for (const [udid, child] of children) {
      const pid = child.pid;
      if (pid) stopProcess(pid);
      clearState(udid);
    }
    children.clear();
    process.exit(exitCode);
  };

  // Monitor children — exit when all die (helper crashed / exited on its own)
  for (const [udid, child] of children) {
    void child.result.then(
      ({ exitCode: code }) => {
        debugHelper("child exit udid=%s pid=%d code=%s", udid, child.pid, code);
        if (shuttingDown) return;
        if (!quiet) console.error(`[${udid}] Helper exited (code ${code})`);
        clearState(udid);
        children.delete(udid);
        if (children.size === 0) cleanup(code ?? 1);
      },
      () => {
        if (shuttingDown) return;
        clearState(udid);
        children.delete(udid);
        if (children.size === 0) cleanup(1);
      },
    );
  }

  // Clean shutdown on signal
  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
  process.on("SIGHUP", () => cleanup(0));

  // Last-resort synchronous cleanup if something else exits the process
  process.on("exit", () => {
    for (const [udid, child] of children) {
      if (child.pid) hostCommands.signal(child.pid, "SIGTERM");
      try {
        clearState(udid);
      } catch {}
    }
  });

  // Block forever
  await new Promise(() => {});
}

/** Detach mode (--detach). Spawns helpers and returns their states. */
async function detach(
  devices: string[],
  startPort: number,
  headed: boolean,
  attachOnly = false,
): Promise<ServerState[]> {
  debugCli("detach devices=%o startPort=%d headed=%s", devices, startPort, headed);
  const existingDefault = devices.length === 0 ? readState() : null;
  const defaultCandidates =
    devices.length > 0 || existingDefault ? null : pickDefaultStreamDevices();
  const udids =
    devices.length > 0
      ? devices.map(resolveDevice)
      : existingDefault
        ? [existingDefault.device]
        : (defaultCandidates ?? []).map((candidate) => candidate.udid);
  if (devices.length === 0 && udids.length === 0) {
    console.error(
      "No device specified and no shutdown iPhone simulator found. Pass a device explicitly to stream a booted simulator.",
    );
    process.exit(1);
  }

  const states: ServerState[] = [];
  let port = startPort;

  for (let index = 0; index < udids.length; index++) {
    const udid = udids[index]!;
    const existing = readState(udid);
    if (existing) {
      states.push(existing);
      if (defaultCandidates) break;
      continue;
    }

    port = await findAvailablePort(port);
    try {
      await startHelper(udid, port, { detach: true, headed, attachOnly });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (defaultCandidates) {
        console.error(
          `Skipping ${defaultCandidates.find((candidate) => candidate.udid === udid)?.name ?? udid}: ${
            message
          }`,
        );
        shutdownDeviceQuietly(udid);
        continue;
      }
      console.error(message);
      process.exit(1);
    }

    states.push(makeServerState(readState(udid)!.pid, port, udid, headed));

    port++;
    if (defaultCandidates) break;
  }

  if (defaultCandidates && states.length === 0) {
    console.error(
      "No shutdown iPhone simulator could be booted. Pass a device explicitly to stream a booted simulator.",
    );
    process.exit(1);
  }

  return states;
}

function printStatesJSON(states: ServerState[]) {
  if (states.length === 1) {
    const s = states[0]!;
    console.log(
      JSON.stringify({
        url: s.url,
        streamUrl: s.streamUrl,
        wsUrl: s.wsUrl,
        port: s.port,
        device: s.device,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        devices: states.map((s) => ({
          url: s.url,
          streamUrl: s.streamUrl,
          wsUrl: s.wsUrl,
          port: s.port,
          device: s.device,
        })),
      }),
    );
  }
}

/** List running streams (--list). */
function listStreams(deviceArg?: string) {
  if (deviceArg) {
    const udid = resolveDevice(deviceArg);
    const state = readState(udid);
    if (!state) {
      console.log(JSON.stringify({ running: false, device: udid }));
    } else {
      console.log(
        JSON.stringify({
          running: true,
          url: state.url,
          streamUrl: state.streamUrl,
          wsUrl: state.wsUrl,
          port: state.port,
          device: state.device,
          pid: state.pid,
        }),
      );
    }
    return;
  }

  const states = readAllStates();
  if (states.length === 0) {
    console.log(JSON.stringify({ running: false }));
  } else if (states.length === 1) {
    const s = states[0]!;
    console.log(
      JSON.stringify({
        running: true,
        url: s.url,
        streamUrl: s.streamUrl,
        wsUrl: s.wsUrl,
        port: s.port,
        device: s.device,
        pid: s.pid,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        running: true,
        streams: states.map((s) => ({
          url: s.url,
          streamUrl: s.streamUrl,
          wsUrl: s.wsUrl,
          port: s.port,
          device: s.device,
          pid: s.pid,
        })),
      }),
    );
  }
}

/** Kill running streams (--kill). */
function killStreams(deviceArg?: string) {
  if (deviceArg) {
    const udid = resolveDevice(deviceArg);
    const state = readState(udid);
    if (!state) {
      console.log(JSON.stringify({ disconnected: true, device: udid }));
      return;
    }
    hostCommands.signal(state.pid, "SIGTERM");
    clearState(udid);
    console.log(JSON.stringify({ disconnected: true, device: state.device }));
  } else {
    const states = readAllStates();
    if (states.length === 0) {
      console.log(JSON.stringify({ disconnected: true, devices: [] }));
      return;
    }
    const devices: string[] = [];
    for (const state of states) {
      hostCommands.signal(state.pid, "SIGTERM");
      devices.push(state.device);
    }
    clearState();
    console.log(JSON.stringify({ disconnected: true, devices }));
  }
}

async function gesture(jsonStr: string, deviceArg?: string) {
  const state = readState(deviceArg);
  if (!state) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }

  let touch: { type: string; x: number; y: number };
  try {
    touch = JSON.parse(jsonStr);
  } catch {
    console.error("Invalid JSON:", jsonStr);
    process.exit(1);
  }

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(state.wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      const json = new TextEncoder().encode(JSON.stringify(touch));
      const msg = new Uint8Array(1 + json.length);
      msg[0] = 0x03;
      msg.set(json, 1);
      ws.send(msg);
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    };

    ws.onerror = () => {
      console.error("Failed to connect to headless-serve-sim server at", state.wsUrl);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

async function tap(xArg: string, yArg: string, deviceArg?: string) {
  const x = Number(xArg);
  const y = Number(yArg);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    console.error("Usage: headless-serve-sim tap <x> <y> [-d udid]");
    console.error("  x, y are normalized 0..1 of the simulator screen");
    console.error("  Example: headless-serve-sim tap 0.5 0.9   # near bottom-center");
    process.exit(1);
  }
  const state = readState(deviceArg);
  if (!state) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(state.wsUrl);
    ws.binaryType = "arraybuffer";
    const send = (type: "begin" | "end") => {
      const json = new TextEncoder().encode(JSON.stringify({ type, x, y }));
      const msg = new Uint8Array(1 + json.length);
      msg[0] = 0x03;
      msg.set(json, 1);
      ws.send(msg);
    };
    ws.onopen = () => {
      send("begin");
      setTimeout(() => {
        send("end");
        setTimeout(() => {
          ws.close();
          resolve();
        }, 50);
      }, 40);
    };
    ws.onerror = () => {
      console.error("Failed to connect to headless-serve-sim server at", state.wsUrl);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

async function typeText(
  positional: string[],
  opts: { device?: string; stdin?: boolean; file?: string },
) {
  const deviceArg = opts.device;
  const useStdin = opts.stdin ?? false;
  const inputFile = opts.file;

  const sourceCount = [positional.length > 0, useStdin, inputFile != null].filter(Boolean).length;
  if (sourceCount === 0 || sourceCount > 1) {
    console.error("Usage: headless-serve-sim type <text> [-d udid]");
    console.error("       headless-serve-sim type --stdin [-d udid]");
    console.error("       headless-serve-sim type --file <path> [-d udid]");
    console.error("");
    console.error("Only US-keyboard ASCII characters are supported (A-Z, a-z, 0-9,");
    console.error("space, newline, tab, and standard punctuation).");
    process.exit(1);
  }

  let text: string;
  if (useStdin) {
    text = readFileSync(0, "utf8");
  } else if (inputFile) {
    try {
      text = readFileSync(inputFile, "utf8");
    } catch (err) {
      console.error(`Failed to read file '${inputFile}': ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    text = positional.join(" ");
  }

  let events;
  try {
    events = textToKeyEvents(text);
  } catch (err) {
    if (err instanceof UnsupportedCharacterError) {
      console.error(err.message);
      console.error("Supported: A-Z, a-z, 0-9, space, newline, tab, and standard punctuation.");
      process.exit(1);
    }
    throw err;
  }

  const state = readState(deviceArg);
  if (!state) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }

  await sendKeyEventsToWs(state.wsUrl, events);
}

async function rotate(orientation: string, deviceArg?: string) {
  const state = readState(deviceArg);
  if (!state) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }

  const valid = new Set(["portrait", "portrait_upside_down", "landscape_left", "landscape_right"]);
  if (!orientation || !valid.has(orientation)) {
    console.error(`Usage: headless-serve-sim rotate <${[...valid].join("|")}> [-d udid]`);
    process.exit(1);
  }

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(state.wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      const json = new TextEncoder().encode(JSON.stringify({ orientation }));
      const msg = new Uint8Array(1 + json.length);
      msg[0] = 0x07;
      msg.set(json, 1);
      ws.send(msg);
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    };

    ws.onerror = () => {
      console.error("Failed to connect to headless-serve-sim server at", state.wsUrl);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

async function button(buttonName = "home", deviceArg?: string) {
  const state = readState(deviceArg);
  if (!state) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(state.wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      const json = new TextEncoder().encode(JSON.stringify({ button: buttonName }));
      const msg = new Uint8Array(1 + json.length);
      msg[0] = 0x04;
      msg.set(json, 1);
      ws.send(msg);
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    };

    ws.onerror = () => {
      console.error("Failed to connect to headless-serve-sim server at", state.wsUrl);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

// Send a CoreAnimation debug option toggle to the helper, which invokes
// -[SimDevice setCADebugOption:enabled:] (CoreSimulator private category).
// The known option strings are the ones Simulator.app uses: see Protocol.swift.
async function caDebug(option: string, stateRaw: string, deviceArg?: string) {
  const stateArg = (stateRaw ?? "").toLowerCase();
  const enabled = stateArg === "on" || stateArg === "1" || stateArg === "true";
  const aliases: Record<string, string> = {
    blended: "debug_color_blended",
    copies: "debug_color_copies",
    copied: "debug_color_copies",
    misaligned: "debug_color_misaligned",
    offscreen: "debug_color_offscreen",
    "slow-animations": "debug_slow_animations",
    slow: "debug_slow_animations",
  };
  const resolved = option ? (aliases[option] ?? option) : undefined;
  if (!resolved || !["on", "off", "1", "0", "true", "false"].includes(stateArg)) {
    console.error(
      `Usage: headless-serve-sim ca-debug <option> <on|off> [-d udid]\n  option shortcuts: ${Object.keys(aliases).join(", ")}`,
    );
    process.exit(1);
  }

  const stateFile = readState(deviceArg);
  if (!stateFile) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(stateFile.wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      const json = new TextEncoder().encode(JSON.stringify({ option: resolved, enabled }));
      const msg = new Uint8Array(1 + json.length);
      msg[0] = 0x08;
      msg.set(json, 1);
      ws.send(msg);
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    };
    ws.onerror = () => {
      console.error("Failed to connect to headless-serve-sim server at", stateFile.wsUrl);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

// Ask the helper to invoke -[SimDevice simulateMemoryWarning].
async function memoryWarning(deviceArg?: string) {
  const stateFile = readState(deviceArg);
  if (!stateFile) {
    console.error("No headless-serve-sim server running. Run `headless-serve-sim` first.");
    process.exit(1);
  }
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(stateFile.wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(new Uint8Array([0x09]));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    };
    ws.onerror = () => {
      console.error("Failed to connect to headless-serve-sim server at", stateFile.wsUrl);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

// ─── Camera injection ───

const NATIVE_PACKAGE_ROOT = join(__dirname, "..", "..", "headless-serve-sim-binary");

/**
 * Resolve the path to the SimCameraInjector dylib. The dev/source layout
 * places it under packages/headless-serve-sim/dist/simcam/; the published npm tarball
 * ships the same file at <package>/dist/simcam/.
 */
function locateCameraDylib(): string | null {
  const nativeSources = join(NATIVE_PACKAGE_ROOT, "Sources");
  const candidates = [
    join(__dirname, "..", "dist", "simcam", "libSimCameraInjector.dylib"),
    join(__dirname, "simcam", "libSimCameraInjector.dylib"),
    join(NATIVE_PACKAGE_ROOT, "dist", "simcam", "libSimCameraInjector.dylib"),
    join(nativeSources, "SimCameraInjector", "build", "libSimCameraInjector.dylib"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return resolve(p);
  }
  return null;
}

function buildCameraDylib(): string {
  const sourceRoot = resolveNativeSourceRoot(__dirname);
  const buildScript = sourceRoot && join(sourceRoot, "SimCameraInjector", "build.sh");
  if (!buildScript || !existsSync(buildScript)) {
    throw new Error(
      "SimCameraInjector source not found — this build of headless-serve-sim does not " +
        "include camera support sources. Reinstall from a recent release.",
    );
  }
  console.error("[headless-serve-sim] building libSimCameraInjector.dylib (one-time)…");
  runHostSync(
    {
      executable: "bash",
      args: [buildScript, join(__dirname, "..", "dist", "simcam")],
      stdio: "inherit",
    },
    "SimCameraInjector build failed",
  );
  const out = locateCameraDylib();
  if (!out) throw new Error("Build succeeded but dylib not found.");
  return out;
}

function locateCameraHelper(): string | null {
  const candidates = [
    join(__dirname, "..", "dist", "simcam", "headless-serve-sim-camera-helper"),
    join(__dirname, "simcam", "headless-serve-sim-camera-helper"),
    join(NATIVE_PACKAGE_ROOT, "dist", "simcam", "headless-serve-sim-camera-helper"),
  ];
  for (const p of candidates) if (existsSync(p)) return resolve(p);
  return null;
}

function buildCameraHelper(): string {
  const sourceRoot = resolveNativeSourceRoot(__dirname);
  const buildScript = sourceRoot && join(sourceRoot, "SimCameraHelper", "build.sh");
  if (!buildScript || !existsSync(buildScript)) {
    throw new Error(
      "SimCameraHelper source not found — this build of headless-serve-sim does not " +
        "include camera support sources. Reinstall from a recent release.",
    );
  }
  console.error("[headless-serve-sim] building headless-serve-sim-camera-helper (one-time)…");
  runHostSync(
    {
      executable: "bash",
      args: [buildScript, join(__dirname, "..", "dist", "simcam")],
      stdio: "inherit",
    },
    "SimCameraHelper build failed",
  );
  const out = locateCameraHelper();
  if (!out) throw new Error("Build succeeded but helper binary not found.");
  return out;
}

const SIMCAM_STATE_DIR = join(STATE_DIR, "simcam");

function helperPidFile(udid: string): string {
  return join(SIMCAM_STATE_DIR, `${udid}.pid`);
}

function helperBundlesFile(udid: string): string {
  return join(SIMCAM_STATE_DIR, `${udid}.bundles.json`);
}

interface InjectedBundlesState {
  helperPid: number;
  bundleIds: string[];
}

function helperSocketFile(udid: string): string {
  // POSIX sun_path is 104 chars on macOS — keep this short.
  const short = createHash("sha1").update(udid).digest("hex").slice(0, 12);
  return `/tmp/headless-serve-sim-cam-${short}.sock`;
}

interface HelperReply {
  ok?: boolean;
  source?: string;
  arg?: string;
  error?: string;
}

async function sendHelperCommand(udid: string, cmd: object): Promise<HelperReply> {
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
    }, 3000);
  });
}

function isHelperAlive(udid: string): boolean {
  const pf = helperPidFile(udid);
  if (!existsSync(pf)) return false;
  const pid = Number(readFileSync(pf, "utf-8").trim());
  return Number.isFinite(pid) && isProcessAlive(pid) && existsSync(helperSocketFile(udid));
}

function readInjectedBundles(udid: string): string[] {
  const path = helperBundlesFile(udid);
  if (!existsSync(path)) return [];
  let state: InjectedBundlesState;
  try {
    state = JSON.parse(readFileSync(path, "utf-8")) as InjectedBundlesState;
  } catch {
    return [];
  }
  let currentHelperPid: number | null = null;
  try {
    currentHelperPid = Number(readFileSync(helperPidFile(udid), "utf-8").trim()) || null;
  } catch {}
  if (currentHelperPid == null || state.helperPid !== currentHelperPid) return [];
  return Array.isArray(state.bundleIds) ? state.bundleIds : [];
}

function recordInjectedBundle(udid: string, bundleId: string, helperPid: number): void {
  const existing = readInjectedBundles(udid);
  const bundleIds = existing.includes(bundleId) ? existing : [...existing, bundleId];
  const next: InjectedBundlesState = { helperPid, bundleIds };
  if (!existsSync(SIMCAM_STATE_DIR)) mkdirSync(SIMCAM_STATE_DIR, { recursive: true });
  writeFileSync(helperBundlesFile(udid), JSON.stringify(next));
}

function clearInjectedBundles(udid: string): void {
  try {
    unlinkSync(helperBundlesFile(udid));
  } catch {}
}

function stopExistingHelper(udid: string) {
  const pf = helperPidFile(udid);
  if (!existsSync(pf)) return;
  const pid = Number(readFileSync(pf, "utf-8").trim());
  if (Number.isFinite(pid) && isProcessAlive(pid)) {
    hostCommands.signal(pid, "SIGTERM");
    // Give it a moment to clean up the shm region.
    const start = Date.now();
    while (isProcessAlive(pid) && Date.now() - start < 1500) sleepSync(50);
  }
  try {
    unlinkSync(pf);
  } catch {}
  clearInjectedBundles(udid);
}

function spawnCameraHelper(args: {
  udid: string;
  helperBin: string;
  shmName: string;
  socketPath: string;
  source: CamSourceKind;
  arg?: string;
  width?: number;
  height?: number;
}): number {
  if (!existsSync(SIMCAM_STATE_DIR)) mkdirSync(SIMCAM_STATE_DIR, { recursive: true });
  const logPath = join(SIMCAM_STATE_DIR, `${args.udid}.log`);
  const argv = ["--shm", args.shmName, "--socket", args.socketPath, "--source", args.source];
  if (args.arg) argv.push("--arg", args.arg);
  if (args.width) argv.push("--width", String(args.width));
  if (args.height) argv.push("--height", String(args.height));
  const child = hostCommands.start({
    executable: args.helperBin,
    args: argv,
    detached: true,
    stdio: { logFile: logPath, append: true },
  });
  child.unref();
  void child.result.catch(() => {});
  if (!child.pid) throw new Error("failed to spawn camera helper");
  writeFileSync(helperPidFile(args.udid), String(child.pid));
  clearInjectedBundles(args.udid);
  // Wait briefly until the helper has populated the shm header AND the
  // control socket is listening (proves it's healthy and ready for switch).
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (!isProcessAlive(child.pid)) {
      throw new Error(`camera helper exited early — see log at ${logPath}`);
    }
    if (existsSync(args.socketPath)) break;
    sleepSync(50);
  }
  return child.pid;
}

type CamSourceKind = "placeholder" | "webcam" | "image" | "video";

interface ResolvedSource {
  kind: CamSourceKind;
  arg?: string;
}

// Tell image/video apart from a path. We sniff the file's magic bytes
// rather than trusting the extension because:
//   1) the file may have arrived via the in-page drop zone, where it
//      lands at /tmp/<uuid> with no meaningful suffix; and
//   2) callers pass real-world paths like .heic / .mov / .gif that
//      shouldn't need a separate flag in the CLI surface.
const VIDEO_EXTS = new Set([
  "mp4",
  "m4v",
  "mov",
  "qt",
  "avi",
  "mkv",
  "webm",
  "mpg",
  "mpeg",
  "3gp",
  "3g2",
  "ts",
  "wmv",
]);
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "heic",
  "heif",
  "webp",
  "bmp",
  "tif",
  "tiff",
]);

function detectMediaKind(filePath: string): "image" | "video" | null {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";

  // Magic-byte sniff — covers files renamed without an extension, plus
  // common containers we didn't enumerate above. Read a 16-byte header.
  let header: Buffer;
  try {
    const fd = openSync(filePath, "r");
    header = Buffer.alloc(16);
    readSync(fd, header, 0, header.length, 0);
    closeSync(fd);
  } catch {
    return null;
  }

  // ISO base media: bytes 4..8 are an "ftyp" box. Catches mp4/mov/m4v/3gp.
  if (header.length >= 8 && header.slice(4, 8).toString("ascii") === "ftyp") {
    return "video";
  }
  // RIFF (WebP / AVI). WEBP / AVI distinguishes via bytes 8..12.
  if (header.slice(0, 4).toString("ascii") === "RIFF" && header.length >= 12) {
    const tag = header.slice(8, 12).toString("ascii");
    if (tag === "AVI ") return "video";
    if (tag === "WEBP") return "image";
  }
  // Matroska / WebM EBML.
  if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return "video";
  }
  // PNG.
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return "image";
  }
  // JPEG.
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image";
  // GIF.
  if (header.slice(0, 6).toString("ascii").startsWith("GIF8")) return "image";
  // BMP.
  if (header[0] === 0x42 && header[1] === 0x4d) return "image";
  return null;
}

function resolveSourceArg(opts: { file?: string; webcam?: string | true }): ResolvedSource {
  if (opts.file) {
    const abs = resolve(opts.file);
    const kind = detectMediaKind(abs);
    if (!kind) {
      throw new Error(`Could not detect image/video type for: ${abs}`);
    }
    return { kind, arg: abs };
  }
  if (opts.webcam) {
    return { kind: "webcam", arg: typeof opts.webcam === "string" ? opts.webcam : undefined };
  }
  return { kind: "placeholder" };
}

async function ensureHelperWithSource(opts: {
  udid: string;
  source: ResolvedSource;
  forceBuild: boolean;
}): Promise<{ helperPid: number | null; shmName: string; relaunched: boolean }> {
  const shmName = cameraShmNameForUdid(opts.udid);
  const sockPath = helperSocketFile(opts.udid);
  if (isHelperAlive(opts.udid)) {
    // Hot-swap source via control socket — no relaunch needed.
    const reply = await sendHelperCommand(opts.udid, {
      action: "switch",
      source: opts.source.kind,
      arg: opts.source.arg,
    });
    if (!reply.ok) throw new Error(reply.error || "helper rejected switch");
    return {
      helperPid: Number(readFileSync(helperPidFile(opts.udid), "utf-8").trim()),
      shmName,
      relaunched: false,
    };
  }
  // Need to start a fresh helper. Pre-emptively reap any stale state.
  stopExistingHelper(opts.udid);
  const helper = (!opts.forceBuild && locateCameraHelper()) || buildCameraHelper();
  const pid = spawnCameraHelper({
    udid: opts.udid,
    helperBin: helper,
    shmName,
    socketPath: sockPath,
    source: opts.source.kind,
    arg: opts.source.arg,
  });
  return { helperPid: pid, shmName, relaunched: true };
}

/**
 * `headless-serve-sim camera <bundle-id> [-d udid] [source-options] [--build]`
 *
 * Launches a simulator app with SimCameraInjector loaded via
 * DYLD_INSERT_LIBRARIES. The host-side helper streams BGRA frames into a
 * POSIX shared-memory region the dylib mmaps; this function picks the source
 * (placeholder / webcam / image), spawns or reuses the helper, and then
 * launches the app. If the helper is already running, source changes are
 * hot-swapped through its control socket without relaunching the app.
 */
async function camera(args: string[]) {
  let deviceArg: string | undefined;
  let filePath: string | undefined;
  let webcam: string | true | undefined;
  let stopWebcam = false;
  let listWebcams = false;
  let forceBuild = false;
  let quiet = false;
  let mirror: "auto" | "on" | "off" = "auto";
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--device" || a === "-d") {
      deviceArg = args[++i];
      continue;
    }
    if (a === "--file" || a === "-f" || a === "--image" || a === "-i" || a === "--video") {
      // --image / --video are kept as silent aliases so existing scripts
      // and the in-page client can land on `--file` without a flag day.
      filePath = args[++i];
      continue;
    }
    if (a === "--webcam") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        webcam = next;
        i++;
      } else {
        webcam = true;
      }
      continue;
    }
    if (a === "--list-webcams") {
      listWebcams = true;
      continue;
    }
    if (a === "--stop-webcam") {
      stopWebcam = true;
      continue;
    }
    if (a === "--build") {
      forceBuild = true;
      continue;
    }
    if (a === "--quiet" || a === "-q") {
      quiet = true;
      continue;
    }
    if (a === "--mirror") {
      const next = args[i + 1];
      if (next === "on" || next === "off" || next === "auto") {
        mirror = next;
        i++;
      } else {
        mirror = "on";
      }
      continue;
    }
    if (a === "--no-mirror") {
      mirror = "off";
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(`Usage: headless-serve-sim camera <bundle-id> [-d udid] [source-options] [--build]
       headless-serve-sim camera switch <placeholder|webcam|file> [arg] [-d udid]
       headless-serve-sim camera mirror <auto|on|off> [-d udid]
       headless-serve-sim camera --list-webcams
       headless-serve-sim camera --stop-webcam [-d udid]

Launches the simulator app with a synthetic camera feed injected. The
host helper streams BGRA frames (default: an animated placeholder) into
shared memory; the dylib swizzles AVFoundation so the app reads them.

If the helper is already running for the device, source flags hot-swap
the feed without relaunching the app.

Source options (pick one; default is placeholder):
  -f, --file <path>          Image or video file (kind auto-detected)
      --webcam [name]        Live host webcam (default: built-in front camera)

Other:
  -d, --device <udid|name>   Target a specific simulator (default: booted)
      --mirror [on|off|auto] Override preview mirroring (default: auto =
                             front mirrored, back not). Data-output buffers
                             are never auto-mirrored, matching AVF defaults.
      --no-mirror            Shortcut for --mirror off
      --build                Rebuild dylib + helper from source
      --list-webcams         List host camera devices (with --webcam values)
      --stop-webcam          Stop the running camera helper for the device
  -q, --quiet                JSON-only output

Examples:
  headless-serve-sim camera com.acme.MyApp                            # placeholder feed
  headless-serve-sim camera com.acme.MyApp --webcam                   # default webcam
  headless-serve-sim camera com.acme.MyApp --webcam "MacBook Pro Camera"
  headless-serve-sim camera com.acme.MyApp --file ~/Pictures/face.png # static image
  headless-serve-sim camera com.acme.MyApp --file ~/Movies/loop.mp4   # looping video
  headless-serve-sim camera switch webcam                             # hot-swap to webcam
  headless-serve-sim camera switch placeholder                        # back to placeholder
  headless-serve-sim camera switch ~/Movies/loop.mp4                  # hot-swap to file
  headless-serve-sim camera --list-webcams
  headless-serve-sim camera --stop-webcam`);
      return;
    }
    filtered.push(a!);
  }

  if (listWebcams) {
    const helper = locateCameraHelper() ?? buildCameraHelper();
    runHostSync(
      {
        executable: helper,
        args: ["--list"],
        stdio: "inherit",
      },
      "camera helper list failed",
    );
    return;
  }

  if (stopWebcam) {
    const udid = deviceArg ? resolveDevice(deviceArg) : findBootedDevice();
    if (!udid) {
      console.error("No booted simulator.");
      process.exit(1);
    }
    const injectedBundles = readInjectedBundles(udid);
    const terminated: string[] = [];
    for (const b of injectedBundles) {
      try {
        runHostSync(
          {
            executable: "xcrun",
            args: ["simctl", "terminate", udid, b],
          },
          `simctl terminate ${b} failed`,
        );
        terminated.push(b);
      } catch {}
    }
    stopExistingHelper(udid);
    if (quiet) console.log(JSON.stringify({ udid, stopped: true, terminated }));
    else {
      console.log(`Stopped camera helper for ${udid}`);
      if (terminated.length > 0) console.log(`Terminated injected apps: ${terminated.join(", ")}`);
    }
    return;
  }

  // `headless-serve-sim camera mirror <auto|on|off> [-d udid]`
  // Hot-swap the preview-layer mirror mode without touching the app.
  if (filtered[0] === "mirror") {
    const udid = deviceArg ? resolveDevice(deviceArg) : findBootedDevice();
    if (!udid) {
      console.error("No booted simulator.");
      process.exit(1);
    }
    const mode = filtered[1];
    if (mode !== "auto" && mode !== "on" && mode !== "off") {
      console.error("Usage: headless-serve-sim camera mirror <auto|on|off> [-d udid]");
      process.exit(1);
    }
    if (!isHelperAlive(udid)) {
      console.error(
        "camera helper not running for this device — run `headless-serve-sim camera <bundle-id>` first.",
      );
      process.exit(1);
    }
    try {
      const reply = await sendHelperCommand(udid, { action: "setMirror", mode });
      if (!reply.ok) {
        console.error(`mirror failed: ${reply.error ?? "?"}`);
        process.exit(1);
      }
      if (quiet) console.log(JSON.stringify({ udid, mirror: mode, ok: true }));
      else console.log(`📷 Mirror → ${mode} on ${udid}`);
    } catch (e: any) {
      console.error(`mirror failed: ${e?.message ?? e}`);
      process.exit(1);
    }
    return;
  }

  // `headless-serve-sim camera switch <source> [arg] [-d udid]`
  // Hot-swap the helper's source without touching the simulator app.
  if (filtered[0] === "switch") {
    const udid = deviceArg ? resolveDevice(deviceArg) : findBootedDevice();
    if (!udid) {
      console.error("No booted simulator.");
      process.exit(1);
    }
    let wanted = filtered[1];
    let arg: string | undefined = filtered[2];
    // `camera switch /path/to/clip.mov` — sniff the file and pick the kind.
    if (
      wanted &&
      wanted !== "placeholder" &&
      wanted !== "webcam" &&
      wanted !== "image" &&
      wanted !== "video" &&
      wanted !== "file"
    ) {
      const candidate = resolve(wanted);
      if (existsSync(candidate)) {
        arg = candidate;
        wanted = "file";
      }
    }
    if (wanted === "file") {
      if (!arg) {
        console.error("camera switch file <path>");
        process.exit(1);
      }
      arg = resolve(arg);
      const detected = detectMediaKind(arg);
      if (!detected) {
        console.error(`Could not detect image/video type for: ${arg}`);
        process.exit(1);
      }
      wanted = detected;
    }
    if (
      !wanted ||
      (wanted !== "placeholder" && wanted !== "webcam" && wanted !== "image" && wanted !== "video")
    ) {
      console.error(
        "Usage: headless-serve-sim camera switch <placeholder|webcam|file> [arg] [-d udid]",
      );
      process.exit(1);
    }
    if ((wanted === "image" || wanted === "video") && arg) arg = resolve(arg);
    if (!isHelperAlive(udid)) {
      console.error(
        "camera helper not running for this device — run `headless-serve-sim camera <bundle-id>` first.",
      );
      process.exit(1);
    }
    try {
      const reply = await sendHelperCommand(udid, { action: "switch", source: wanted, arg });
      if (!reply.ok) {
        console.error(`switch failed: ${reply.error ?? "?"}`);
        process.exit(1);
      }
      if (quiet) console.log(JSON.stringify({ udid, ...reply }));
      else
        console.log(`📷 Switched ${udid} → ${reply.source}${reply.arg ? ` (${reply.arg})` : ""}`);
    } catch (e: any) {
      console.error(`switch failed: ${e?.message ?? e}`);
      process.exit(1);
    }
    return;
  }

  // `headless-serve-sim camera status [-d udid]` — JSON-only probe used by the
  // preview UI (and humans) to see whether the helper is still alive after
  // a page reload, so we don't have to "Inject + relaunch" the app just to
  // re-establish UI state.
  if (filtered[0] === "status") {
    const udid = deviceArg ? resolveDevice(deviceArg) : findBootedDevice();
    if (!udid) {
      console.log(JSON.stringify({ alive: false, error: "no booted simulator" }));
      return;
    }
    if (!isHelperAlive(udid)) {
      console.log(JSON.stringify({ udid, alive: false }));
      return;
    }
    let helperPid: number | null = null;
    try {
      helperPid = Number(readFileSync(helperPidFile(udid), "utf-8").trim()) || null;
    } catch {}
    const bundleIds = readInjectedBundles(udid);
    try {
      const reply = await sendHelperCommand(udid, { action: "status" });
      console.log(JSON.stringify({ udid, alive: true, helperPid, bundleIds, ...reply }));
    } catch (e: any) {
      // pid file + socket exist but the helper didn't reply — surface
      // alive:true so the UI can still skip "Inject + relaunch", and
      // include the error for diagnosis.
      console.log(
        JSON.stringify({ udid, alive: true, helperPid, bundleIds, error: e?.message ?? String(e) }),
      );
    }
    return;
  }

  const bundleId = filtered[0];
  if (!bundleId) {
    console.error("Usage: headless-serve-sim camera <bundle-id> [--image <path>] [-d udid]");
    process.exit(1);
  }

  const udid = deviceArg ? resolveDevice(deviceArg) : findBootedDevice();
  if (!udid) {
    console.error("No booted simulator. Boot one or pass -d <udid|name>.");
    process.exit(1);
  }

  let dylib = forceBuild ? null : locateCameraDylib();
  if (!dylib) {
    try {
      dylib = buildCameraDylib();
    } catch (e: any) {
      console.error(`Failed to obtain camera dylib: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  if (filePath && webcam) {
    console.error("Pick one source: --file or --webcam, not both.");
    process.exit(1);
  }

  if (filePath) {
    filePath = resolve(filePath);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
  }

  // Default source is the animated placeholder. The helper always runs so
  // the dylib reads from a single shm wire format regardless of source.
  let source: ResolvedSource;
  try {
    source = resolveSourceArg({ file: filePath, webcam });
  } catch (e: any) {
    console.error(e?.message ?? String(e));
    process.exit(1);
  }
  const helperRes = await ensureHelperWithSource({ udid, source, forceBuild });
  const shmName = helperRes.shmName;
  const helperPid = helperRes.helperPid;

  // Mirror lives in the shm header so it can hot-swap. Push every time —
  // the dylib watches the byte each frame and re-applies the layer
  // transform when it differs from the last seen value.
  if (mirror !== "auto" || !helperRes.relaunched) {
    try {
      await sendHelperCommand(udid, { action: "setMirror", mode: mirror });
    } catch {} // non-fatal; dylib falls back to env or default
  }

  // Always (re)launch the named bundle with the dylib. The helper feeds a
  // single shm region keyed by udid, so multiple apps on the same simulator
  // can attach to the same camera stream — but each one has to be launched
  // with DYLD_INSERT_LIBRARIES, which means a terminate+relaunch every time
  // we want to bring a new app into the set. Source-only hot-swaps go
  // through `camera switch`, not this path.
  try {
    runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "privacy", udid, "grant", "camera", bundleId],
      },
      "simctl privacy grant camera failed",
    );
  } catch {}
  try {
    runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "terminate", udid, bundleId],
      },
      `simctl terminate ${bundleId} failed`,
    );
  } catch {}

  const env = {
    ...process.env,
    SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: dylib,
    SIMCTL_CHILD_SIMCAM_SHM_NAME: shmName,
    ...(mirror !== "auto" ? { SIMCTL_CHILD_SIMCAM_MIRROR_MODE: mirror } : {}),
  };

  let stdoutBuf = "";
  try {
    stdoutBuf = runHostSync(
      {
        executable: "xcrun",
        args: ["simctl", "launch", udid, bundleId],
        env,
      },
      `simctl launch ${bundleId} failed`,
    ).toString();
  } catch (e: any) {
    console.error(`simctl launch failed: ${e?.stderr ?? e?.message ?? e}`);
    process.exit(1);
  }

  const pidMatch = stdoutBuf.trim().match(/:\s*(\d+)\s*$/);
  const pid = pidMatch ? Number(pidMatch[1]) : null;

  if (helperPid) recordInjectedBundle(udid, bundleId, helperPid);

  const result = {
    udid,
    bundleId,
    pid,
    dylib,
    source: source.kind,
    arg: source.arg ?? null,
    shm: shmName,
    helperPid,
    mirror,
    hotSwapped: false,
    helperRelaunched: helperRes.relaunched,
  };
  if (quiet) {
    console.log(JSON.stringify(result));
  } else {
    const verb = helperRes.relaunched ? "Injected" : "Attached";
    console.log(`📷 ${verb} camera into ${bundleId} (pid ${pid ?? "?"}) on ${udid}`);
    console.log(`   source: ${source.kind}${source.arg ? ` (${source.arg})` : ""}`);
    if (helperPid) console.log(`   helper pid: ${helperPid}  (shm ${shmName})`);
    console.log(`   dylib: ${dylib}`);
  }
}

// ─── Serve preview ───

async function serve(
  servePort: number,
  devices: string[],
  portExplicit: boolean,
  host: string,
  headed: boolean,
) {
  let targetDevice: string | undefined;

  if (devices.length > 0) {
    const states = await detach(devices, 3100, headed);
    targetDevice = states[0]?.device;
  }

  const { simMiddleware } = await import("./middleware");
  const middleware = simMiddleware({ basePath: "/", device: targetDevice });

  // Try requested port; if busy and the user didn't pin it, scan forward.
  const maxScan = portExplicit ? 1 : 50;
  let boundPort = servePort;
  let lastErr: unknown;
  let bound = false;
  for (let i = 0; i < maxScan; i++) {
    const p = servePort + i;
    try {
      await bindPreviewServer(p, middleware, host);
      boundPort = p;
      bound = true;
      break;
    } catch (err: any) {
      lastErr = err;
      if (err?.code !== "EADDRINUSE") break;
    }
  }
  if (!bound) {
    if ((lastErr as any)?.code === "EADDRINUSE") {
      if (portExplicit) {
        console.error(
          `Port ${servePort} is already in use. Pass a different --port or stop the other process.`,
        );
      } else {
        console.error(`No available port found in range ${servePort}-${servePort + maxScan - 1}.`);
      }
    } else {
      console.error(`Failed to start preview server: ${(lastErr as any)?.message ?? lastErr}`);
    }
    process.exit(1);
  }

  const exposedToLan = host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
  const networkIP = getLocalNetworkIP();
  console.log("");
  console.log(`  - Local:   http://localhost:${boundPort}`);
  if (exposedToLan && networkIP) {
    console.log(`  - Network: http://${networkIP}:${boundPort}`);
  } else if (networkIP) {
    console.log(
      `  - Network: \x1b[2muse --host 0.0.0.0 to expose on http://${networkIP}:${boundPort}\x1b[0m`,
    );
  } else {
    console.log("  - Network: \x1b[2muse --host 0.0.0.0 to expose on the LAN\x1b[0m");
  }
  console.log("");

  // Exit cleanly on Ctrl+C
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  await new Promise(() => {});
}

function bindPreviewServer(
  port: number,
  middleware: ReturnType<typeof import("./middleware").simMiddleware>,
  host: string,
) {
  return servePreview({ port, middleware, host });
}

// ─── Main ───

const program = new Command();

program
  .name("headless-serve-sim")
  .description("Stream iOS Simulator to the browser")
  .helpOption("-h, --help", "Show this help")
  // The default command: start the preview server (or stream / list / kill).
  .argument("[devices...]", "Simulator(s) to target (udid or name); omit to choose in the preview")
  .option("-p, --port <port>", "Starting port (preview default: 3200, stream default: 3100)", (v) =>
    parseInt(v, 10),
  )
  .option(
    "--host <addr>",
    "Interface to bind the preview server to. Use 0.0.0.0 to expose on the " +
      "LAN — only on trusted networks: the preview exposes a token-gated " +
      "shell-exec route.",
    "127.0.0.1",
  )
  .option("--detach", "Spawn helper and exit (daemon mode)")
  .option("--attach-only", "Attach to an already-booted simulator; never boot it")
  .option("-q, --quiet", "Suppress human-readable output, JSON only")
  .option("--no-preview", "Skip the web preview server; stream in foreground only")
  .option(
    "--headed",
    "Launch the Simulator.app window alongside the stream. " +
      "Default is headless (no GUI window).",
  )
  .option("-l, --list [device]", "List running streams")
  .option("-k, --kill [device]", "Kill running stream(s)")
  .addHelpText(
    "after",
    `
Examples:
  headless-serve-sim                              Open the simulator picker at localhost:3200
  headless-serve-sim -p 8080                      Preview on a custom port
  headless-serve-sim --no-preview "iPhone 16 Pro" Stream a specific device (no preview)
  headless-serve-sim --detach "iPhone 16 Pro"     Start a selected simulator stream in background
  headless-serve-sim --list                       Show all running streams
  headless-serve-sim --kill                       Stop all streams`,
  )
  .action(async (devices: string[], opts) => {
    if (opts.list !== undefined) {
      listStreams(typeof opts.list === "string" ? opts.list : undefined);
      return;
    }
    if (opts.kill !== undefined) {
      killStreams(typeof opts.kill === "string" ? opts.kill : undefined);
      return;
    }
    const startPort: number | undefined = opts.port;
    const headed: boolean = !!opts.headed;
    if (devices.length === 0 && (opts.detach || opts.preview === false)) {
      console.error("Select a simulator explicitly when starting a stream.");
      process.exitCode = 1;
      return;
    }
    if (opts.detach) {
      const states = await detach(devices, startPort ?? 3100, headed, !!opts.attachOnly);
      printStatesJSON(states);
    } else if (opts.preview === false) {
      await follow(devices, startPort ?? 3100, !!opts.quiet, headed);
    } else {
      await serve(startPort ?? 3200, devices, startPort !== undefined, opts.host, headed);
    }
  });

const deviceOpt = ["-d, --device <udid>", "Target a specific simulator (udid or name)"] as const;

program
  .command("gesture")
  .description("Send a touch gesture")
  .argument("<json>", 'Gesture JSON, e.g. \'{"type":"begin","x":0.5,"y":0.5}\'')
  .option(...deviceOpt)
  .action((json: string, opts) => gesture(json, opts.device));

program
  .command("tap")
  .description("Tap at normalized 0..1 coords")
  .argument("<x>", "X coord, normalized 0..1")
  .argument("<y>", "Y coord, normalized 0..1")
  .option(...deviceOpt)
  .action((x: string, y: string, opts) => tap(x, y, opts.device));

program
  .command("button")
  .description("Send a hardware button press")
  .argument("[name]", "Button name", "home")
  .option(...deviceOpt)
  .action((name: string, opts) => button(name, opts.device));

program
  .command("type")
  .description("Type text (US keyboard only)")
  .argument("[text...]", "Text to type")
  .option(...deviceOpt)
  .option("--stdin", "Read text from stdin")
  .option("--file <path>", "Read text from a file")
  .action((text: string[], opts) =>
    typeText(text, { device: opts.device, stdin: opts.stdin, file: opts.file }),
  );

program
  .command("rotate")
  .description(
    "Set device orientation " + "(portrait|portrait_upside_down|landscape_left|landscape_right)",
  )
  .argument("<orientation>")
  .option(...deviceOpt)
  .action((orientation: string, opts) => rotate(orientation, opts.device));

program
  .command("ca-debug")
  .description(
    "Toggle a CoreAnimation debug render flag " +
      "(blended|copies|misaligned|offscreen|slow-animations)",
  )
  .argument("<option>")
  .argument("<state>", "on|off")
  .option(...deviceOpt)
  .action((option: string, state: string, opts) => caDebug(option, state, opts.device));

program
  .command("memory-warning")
  .description("Simulate a memory warning on the device")
  .option(...deviceOpt)
  .action((opts) => memoryWarning(opts.device));

// `camera` and `permissions` keep their own dedicated argument parsers (the
// camera verb has nested sub-verbs and source flags; permissions has a
// unit-tested parser module). Register them as passthrough commands so they
// still appear in `--help` and route to those parsers verbatim.
program
  .command("camera")
  .description("Inject a synthetic camera feed and launch an app (see `camera --help`)")
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  .action((args: string[]) => camera(args));

program
  .command("permissions")
  .description("Manage app permissions (see `permissions` with no args for usage)")
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  .action(async (args: string[]) => {
    process.exitCode = await permissions(args, permissionsDependencies);
  });

program
  .command("document")
  .description(
    "Import documents into the simulator's Files app (see `document` with no args for usage)",
  )
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  // Commander binds the root's -q/--quiet here even when it trails this
  // passthrough subcommand, so read it from the root and forward to the parser.
  .action((args: string[]) => document(program.opts().quiet ? [...args, "--quiet"] : args));

program
  .command("status-bar")
  .description("Override the simulator status bar (see `status-bar` with no args for usage)")
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  // The parser consumes -q/--quiet itself; forward the root flag like `document`.
  .action((args: string[]) => statusBar(program.opts().quiet ? [...args, "--quiet"] : args));

program
  .command("defaults")
  .description("Read/write the simulator's user defaults (see `defaults` with no args for usage)")
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  // The parser consumes -q/--quiet itself; forward the root flag like `document`.
  .action((args: string[]) => userDefaults(program.opts().quiet ? [...args, "--quiet"] : args));

program
  .command("app-actions")
  .description(
    "Open a URL, send a push, or reset the keychain (see `app-actions` with no args for usage)",
  )
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  // The parser consumes -q/--quiet itself; forward the root flag like `document`.
  .action((args: string[]) => appActions(program.opts().quiet ? [...args, "--quiet"] : args));

program
  .command("screenshot")
  .description(
    "Capture the simulator display to an image (see `screenshot` with no args for usage)",
  )
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  // The parser consumes -q/--quiet itself; forward the root flag like `document`.
  .action((args: string[]) => screenshot(program.opts().quiet ? [...args, "--quiet"] : args));

program
  .command("ui")
  .description(
    "Get/set simulator-wide UI settings: appearance, color filter, text size, motion… (see `ui` with no args for usage)",
  )
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[args...]")
  .action((args: string[]) => uiSettings(args));

await program.parseAsync(process.argv);
