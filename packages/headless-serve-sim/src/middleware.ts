import { readdirSync, readFileSync, existsSync, unlinkSync, watch, type FSWatcher } from "fs";
import { execSync, spawn, exec, execFile, type ChildProcess, type ExecException } from "child_process";
import { sampleAppMetrics } from "./app-metrics";
import { tmpdir } from "os";
import { join } from "path";
import { createServer as createNetServer } from "net";
import { randomBytes, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { createAxStreamerCache } from "./ax";
import { debugMw } from "./debug";
import { createExecUpgradeHandler, type UiRequestHandler } from "./exec-ws";
import { UI_OPTIONS, getUiStatus, normalizeUiValue, setUiOption } from "./ui-settings";

type SimReq = IncomingMessage;
type SimRes = ServerResponse;
type SimNext = (err?: unknown) => void;

// Injected at build time as a base64-encoded string via `define`
declare const __PREVIEW_HTML_B64__: string;
const STATE_DIR = join(tmpdir(), "headless-serve-sim");
// Last logged result of a GET /api selection, used to suppress the
// once-every-poll duplicate debugMw lines (the UI polls /api every ~2s).
let lastApiLogKey: string | undefined;
const DEVTOOLS_FRONTEND_REV = "854a02be78c7ffea104cb523636efa991bef5c5b";
const INSPECT_WEBKIT_START_PORT = 9222;

type WebKitBridgeTarget = {
  id: string;
  title: string;
  url: string;
  type: string;
  appName?: string;
  bundleId?: string;
  /** udid of the simulator hosting the target, when known. */
  udid?: string;
  inUseByOtherInspector?: boolean;
};

type WebKitBridge = {
  port: number;
  cdpUrl: string;
  listTargets(): Promise<WebKitBridgeTarget[]>;
  highlightTarget?(targetId: string, on: boolean): Promise<void>;
  releaseHighlight?(targetId?: string): void;
};

type InspectWebKitBridgeTarget = {
  targetId: string;
  title?: string;
  appName?: string;
  url?: string;
  type?: string;
  bundleId?: string;
  inUseByOtherInspector?: boolean;
  source?: { kind?: string; id?: string };
};

type CdpHttpListEntry = {
  id: string;
  title: string;
  url: string;
  type: string;
  description?: string;
};

type CdpHttpVersion = { Browser?: string };

type SimctlBootedList = {
  devices: Record<string, Array<{ udid: string; state: string }>>;
};

type SimctlAllList = {
  devices: Record<string, Array<Omit<SimctlDevice, "runtime">>>;
};

type ShutdownRequestBody = { udid?: string };
type StartRequestBody = { udid?: string };
type ReleaseRequestBody = { targetId?: string };
type HighlightRequestBody = { targetId?: string; on?: boolean };
type ExecRequestBody = { command?: string };

export interface ServeSimState {
  pid: number;
  port: number;
  device: string;
  url: string;
  streamUrl: string;
  wsUrl: string;
}

const axStreamerCache = createAxStreamerCache();

// Hard cap on the SSE line-assembly buffer for child-process stdout.
// A malformed log entry without a newline can't grow this beyond 1 MB;
// the partial line is dropped rather than retained indefinitely.
const SSE_LINE_BUFFER_LIMIT = 1024 * 1024;
let inspectWebKitBridge: Promise<WebKitBridge> | null = null;

// Known bundle IDs that are always React Native shells (used as a fallback
// before the app-container path resolves, since simctl can lag after launch).
const RN_BUNDLE_IDS = new Set<string>([
  "host.exp.Exponent",       // Expo Go (App Store)
  "dev.expo.Exponent",       // Expo Go dev builds
]);

const RN_MARKERS = [
  "Frameworks/React.framework",
  "Frameworks/hermes.framework",
  "Frameworks/Hermes.framework",
  "Frameworks/ExpoModulesCore.framework",
  "main.jsbundle",
];

// Processes that SpringBoard logs as "Foreground" but are not the visible
// user-facing app — widgets, extensions, background services. Emitting
// these to the client causes the app indicator to flicker as the user
// actually-foreground app switches mid-launch.
const NON_UI_BUNDLE_RE = /(WidgetRenderer|ExtensionHost|\.extension(\.|$)|Service|PlaceholderApp|InCallService|CallUI|InCallUI|com\.apple\.Preferences\.Cellular|com\.apple\.purplebuddy|com\.apple\.chrono|com\.apple\.shuttle|com\.apple\.usernotificationsui)/i;

function isUserFacingBundle(bundleId: string): boolean {
  return !NON_UI_BUNDLE_RE.test(bundleId);
}

export function parseForegroundAppLogMessage(message: string): { bundleId: string; pid: number } | null {
  // e.g. "[app<com.apple.mobilesafari>:43117] Setting process visibility to: Foreground"
  const match = /\[app<([^>]+)>:(\d+)\] Setting process visibility to: Foreground/.exec(message);
  if (!match) return null;
  return { bundleId: match[1]!, pid: parseInt(match[2]!, 10) };
}

function detectReactNative(udid: string, bundleId: string): Promise<boolean> {
  if (RN_BUNDLE_IDS.has(bundleId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"],
      { timeout: 2000 },
      (err, stdout) => {
        if (err) return resolve(false);
        const appPath = stdout.trim();
        if (!appPath) return resolve(false);
        for (const marker of RN_MARKERS) {
          if (existsSync(join(appPath, marker))) return resolve(true);
        }
        resolve(false);
      });
  });
}

type InstalledApp = {
  CFBundleDisplayName?: string;
  CFBundleExecutable?: string;
  CFBundleIdentifier?: string;
  CFBundleName?: string;
};

function normalizeAppName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function matchInstalledAppByDisplayName(
  apps: Record<string, InstalledApp>,
  displayName: string,
): string | null {
  const wanted = normalizeAppName(displayName);
  if (!wanted) return null;

  for (const [bundleId, app] of Object.entries(apps)) {
    const names = [
      app.CFBundleDisplayName,
      app.CFBundleName,
      app.CFBundleExecutable,
    ].filter((value): value is string => typeof value === "string");
    if (names.some((name) => normalizeAppName(name) === wanted)) {
      return app.CFBundleIdentifier || bundleId;
    }
  }
  return null;
}

// Cache simctl's booted-device set briefly so per-request cost stays bounded.
// The middleware runs inside the user's dev server (Metro etc.) and
// readServeSimStates() is called on every /api and every page load.
let bootedSnapshot: { at: number; booted: Set<string> | null } = { at: 0, booted: null };
function getBootedUdids(): Set<string> | null {
  const now = Date.now();
  if (bootedSnapshot.booted && now - bootedSnapshot.at < 1500) {
    return bootedSnapshot.booted;
  }
  try {
    const output = execSync("xcrun simctl list devices booted -j", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3_000,
    });
    const data = JSON.parse(output) as SimctlBootedList;
    const booted = new Set<string>();
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.state === "Booted") booted.add(device.udid);
      }
    }
    bootedSnapshot = { at: now, booted };
    return booted;
  } catch {
    return null;
  }
}

function readServeSimStates(): ServeSimState[] {
  let files: string[];
  try {
    files = readdirSync(STATE_DIR).filter(
      (f) => f.startsWith("server-") && f.endsWith(".json"),
    );
  } catch {
    return [];
  }
  const booted = getBootedUdids();
  const states: ServeSimState[] = [];
  for (const f of files) {
    const path = join(STATE_DIR, f);
    try {
      const state: ServeSimState = JSON.parse(readFileSync(path, "utf-8"));
      try {
        process.kill(state.pid, 0);
      } catch {
        debugMw("helper pid=%d gone, removing %s", state.pid, path);
        try { unlinkSync(path); } catch {}
        continue;
      }
      // Helper alive but its simulator was shut down — the MJPEG stream
      // would accept connections yet never produce frames, leaving the
      // preview stuck on "Connecting...". Recycle the stale state so the
      // caller can spawn a fresh helper bound to whatever is booted.
      if (booted && !booted.has(state.device)) {
        debugMw(
          "recycling stale helper pid=%d (device %s no longer booted)",
          state.pid,
          state.device,
        );
        try { process.kill(state.pid, "SIGTERM"); } catch {}
        try { unlinkSync(path); } catch {}
        continue;
      }
      states.push(state);
    } catch {}
  }
  return states;
}

export function selectServeSimState(
  states: ServeSimState[],
  device?: string | null,
): ServeSimState | null {
  if (device) {
    return states.find((state) => state.device === device) ?? null;
  }
  return states[0] ?? null;
}

function queryDevice(rawUrl: string): string | null {
  const qIndex = rawUrl.indexOf("?");
  if (qIndex === -1) return null;
  return new URLSearchParams(rawUrl.slice(qIndex + 1)).get("device");
}

function endpoint(base: string, path: string, device: string): string {
  const value = `${base}${path}`;
  return `${value}?device=${encodeURIComponent(device)}`;
}

/**
 * Rewrite the helper URLs in a state so they point at the hostname the request
 * came in on. The helper binds on `*:<port>`, so once the host portion matches
 * the dev-server origin, a remote viewer (LAN, or tunnel exposing the helper
 * port under the same hostname) can reach the stream. Loopback callers get
 * the state untouched.
 */
export function rewriteStateForRequestHost(
  state: ServeSimState,
  hostHeader: string | undefined,
): ServeSimState {
  if (!hostHeader) return state;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return state;
  }
  // `URL.hostname` keeps brackets around IPv6 literals, so the IPv6 loopback
  // comparison is against the bracketed form rather than `::1`.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return state;
  }
  const rewrite = (s: string) => s.replace("127.0.0.1", hostname);
  return {
    ...state,
    url: rewrite(state.url),
    streamUrl: rewrite(state.streamUrl),
    wsUrl: rewrite(state.wsUrl),
  };
}

/** The helper's live screen geometry (from its `/config` route). */
export interface HelperScreenConfig {
  width: number;
  height: number;
  orientation?: string;
}

/**
 * Validate the helper's `/config` JSON. Returns null unless it carries positive
 * pixel dimensions, so a helper that answered before it knew the screen size
 * ({width:0}) is treated as "unknown" and the client keeps its generic fallback.
 */
export function parseScreenConfig(raw: unknown): HelperScreenConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const { width, height, orientation } = raw as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!(width > 0) || !(height > 0)) return null;
  return {
    width,
    height,
    ...(typeof orientation === "string" ? { orientation } : {}),
  };
}

/**
 * Pull the live screen config from the helper's `/config` so the very first
 * paint sizes the device frame correctly (no post-load resize). Best-effort: a
 * slow or absent helper resolves to null and the client uses its generic
 * fallback exactly as before, so the page never blocks on it.
 */
export async function fetchHelperScreenConfig(
  helperUrl: string,
  timeoutMs = 250,
): Promise<HelperScreenConfig | null> {
  try {
    const res = await fetch(`${helperUrl}/config`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return parseScreenConfig(await res.json());
  } catch {
    return null;
  }
}

/**
 * Serialize a value as JSON that is safe to embed inside an inline `<script>`.
 * `JSON.stringify` leaves `<`, `>`, `&` and the JS line terminators U+2028/U+2029
 * unescaped, so a value containing `</script>` (e.g. a maliciously renamed
 * simulator) would break out of the tag and run as markup — XSS, and the page
 * carries the `/exec` bearer token. Replacing those with `\uXXXX` escapes is
 * value-preserving (inside a JS string literal `<` === `<`) and the result
 * is still valid JSON, so `JSON.parse` on the client reads the identical object.
 */
export function htmlSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function previewConfigForState(
  state: ServeSimState,
  base: string,
  serveSimBin: string,
  execToken: string,
  screenConfig?: HelperScreenConfig | null,
  deviceName?: string | null,
): ServeSimState & {
  basePath: string;
  logsEndpoint: string;
  appStateEndpoint: string;
  axEndpoint: string;
  devtoolsEndpoint: string;
  serveSimBin: string;
  gridApiEndpoint: string;
  gridStartEndpoint: string;
  gridShutdownEndpoint: string;
  gridMemoryEndpoint: string;
  previewEndpoint: string;
  execToken: string;
  screenConfig?: HelperScreenConfig;
  deviceName?: string;
} {
  const gridApiBase = (base === "" ? "" : base) + "/grid/api";
  return {
    ...state,
    ...(screenConfig ? { screenConfig } : {}),
    ...(deviceName ? { deviceName } : {}),
    basePath: base,
    logsEndpoint: endpoint(base, "/logs", state.device),
    appStateEndpoint: endpoint(base, "/appstate", state.device),
    axEndpoint: endpoint(base, "/ax", state.device),
    devtoolsEndpoint: endpoint(base, "/devtools", state.device),
    serveSimBin,
    gridApiEndpoint: gridApiBase,
    gridStartEndpoint: gridApiBase + "/start",
    gridShutdownEndpoint: gridApiBase + "/shutdown",
    gridMemoryEndpoint: gridApiBase + "/memory",
    previewEndpoint: base === "" ? "/" : base,
    execToken,
  };
}

async function isLocalPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function existingInspectWebKitBridge(port: number): Promise<WebKitBridge | null> {
  const cdpUrl = `http://127.0.0.1:${port}`;
  try {
    const versionRes = await fetch(`${cdpUrl}/json/version`);
    if (!versionRes.ok) return null;
    const version = await versionRes.json() as CdpHttpVersion;
    if (version.Browser !== "Safari/inspect-webkit") return null;
    return {
      port,
      cdpUrl,
      async listTargets() {
        // Hitting the bridge over HTTP loses the rich fields available to
        // an in-process consumer (appName, inUseByOtherInspector). The id
        // shape `sim:<udid>:<appId>:<pageId>` and the description string
        // `<deviceLabel> (<bundleId>)` are all we have here.
        const listRes = await fetch(`${cdpUrl}/json/list`);
        const targets = await listRes.json() as CdpHttpListEntry[];
        return targets
          .filter((target) => target.id.startsWith("sim:"))
          .map((target) => {
            const idParts = target.id.split(":");
            const udid = idParts[1];
            const bundleId = target.description?.match(/\(([^)]+)\)/)?.[1];
            return {
              id: target.id,
              title: target.title || target.url || "Untitled",
              url: /^https?:/i.test(target.url) ? target.url : "about:blank",
              type: target.type || "page",
              udid,
              bundleId,
            };
          });
      },
    };
  } catch {
    return null;
  }
}

async function ensureInspectWebKitBridge(): Promise<WebKitBridge> {
  if (inspectWebKitBridge) {
    try {
      // Probe so a dead bridge gets retired instead of poisoning every call.
      await (await inspectWebKitBridge).listTargets();
      return inspectWebKitBridge;
    } catch {
      inspectWebKitBridge = null;
    }
  }
  inspectWebKitBridge = (async () => {
    const { startCdpServer } = await import("inspect-webkit");
    for (let port = INSPECT_WEBKIT_START_PORT; port < INSPECT_WEBKIT_START_PORT + 50; port++) {
      if (!(await isLocalPortFree(port))) {
        const existing = await existingInspectWebKitBridge(port);
        if (existing) return existing;
        continue;
      }
      try {
        // Bind explicitly to IPv4 127.0.0.1 to match what bridgeWsHost emits
        // (and what the DevTools frontend CSP whitelists). `localhost` resolves
        // to ::1 first on some setups, which would leave the iframe's
        // ws://127.0.0.1:9222 connection refused.
        const server = await startCdpServer({ host: "127.0.0.1", port }) as Awaited<ReturnType<typeof startCdpServer>> & {
          highlightTarget?(targetId: string, on: boolean): Promise<void>;
          releaseHighlight?(targetId?: string): void;
        };
        return {
          port,
          cdpUrl: `http://127.0.0.1:${port}`,
          async listTargets() {
            return (server.getTargets() as InspectWebKitBridgeTarget[])
              .filter((target) => target.source?.kind === "simulator")
              .map((target) => {
                const url = target.url ?? "";
                return {
                  id: target.targetId,
                  title: target.title || target.appName || url || "Untitled",
                  url: /^https?:/i.test(url) ? url : "about:blank",
                  type: target.type || "page",
                  appName: target.appName,
                  bundleId: target.bundleId,
                  udid: target.source?.id,
                  inUseByOtherInspector: !!target.inUseByOtherInspector,
                };
              });
          },
          highlightTarget: server.highlightTarget?.bind(server),
          releaseHighlight: server.releaseHighlight?.bind(server),
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
          const existing = await existingInspectWebKitBridge(port);
          if (existing) return existing;
          continue;
        }
        throw err;
      }
    }
    throw new Error(`No available inspect-webkit port found in ${INSPECT_WEBKIT_START_PORT}-${INSPECT_WEBKIT_START_PORT + 49}`);
  })().catch((err) => {
    inspectWebKitBridge = null;
    throw err;
  });
  return inspectWebKitBridge;
}

function devtoolsFrontendUrl(frontendBase: string, wsHost: string, targetId: string): string {
  const url = new URL(`${frontendBase}/inspector.html`, "http://headless-serve-sim.local");
  url.searchParams.set("ws", `${wsHost}/devtools/page/${targetId}`);
  return `${url.pathname}${url.search}`;
}

// The inspect-webkit bridge binds locally. Always emit `127.0.0.1` rather
// than `localhost` for the iframe's WS URL: the chrome-devtools-frontend
// inspector.html ships a CSP whose connect-src only whitelists
// `ws://127.0.0.1:*` (plus `'self'`, which doesn't cover the bridge's
// different port). A `ws://localhost:9222/...` connection from the iframe
// gets CSP-blocked and surfaces as "WebSocket disconnected."
// Non-local hostnames fall back to 127.0.0.1 since the bridge isn't
// reachable from off-host anyway.
function bridgeWsHost(_reqHost: string | undefined, bridgePort: number): string {
  return `127.0.0.1:${bridgePort}`;
}

let _html: string | null = null;
/**
 * Pure: derive a browser-usable CLI string from a resolved invocation. The
 * in-page tools re-derive the runtime from the extension (`.ts` → `bun <p>`,
 * `.js` → `node <p>`); a bare command (compiled binary / PATH) is used as-is.
 * Returns `headless-serve-sim` (resolved on PATH at exec time) when the entry
 * can't be pinpointed — e.g. embedded inside a host dev server.
 */
export function serveSimBinFor(
  invocation: { command: string; baseArgs: string[] } | null,
): string {
  if (!invocation) return "headless-serve-sim";
  return invocation.baseArgs.length > 0
    ? invocation.baseArgs[invocation.baseArgs.length - 1]!
    : invocation.command;
}

/**
 * Best-effort browser-usable command for the running headless-serve-sim CLI so
 * the in-page tools (camera, permissions, document import) can shell out to it
 * via /exec regardless of how the server was launched. Crucially this must NOT
 * be a `bun --compile` `/$bunfs/...` virtual path — /bin/sh can't exec it.
 */
function serveSimBinPath(): string {
  return serveSimBinFor(resolveServeSimCommand());
}

function loadHtml(): string {
  if (!_html) {
    _html = Buffer.from(__PREVIEW_HTML_B64__, "base64").toString("utf-8");
  }
  return _html;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  runtime: string;
}

function listAllSimulators(): SimctlDevice[] {
  try {
    const output = execSync("xcrun simctl list devices -j", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
    const data = JSON.parse(output) as SimctlAllList;
    const out: SimctlDevice[] = [];
    for (const [runtime, devices] of Object.entries(data.devices)) {
      // Keep this to touch-capable simulator families that headless-serve-sim can frame
      // and inject into. tvOS is intentionally left out for now.
      if (!/SimRuntime\.(iOS|watchOS|visionOS|xrOS)-/i.test(runtime)) continue;
      for (const d of devices) {
        if (d.isAvailable === false) continue;
        out.push({ ...d, runtime: runtime.replace(/^.*SimRuntime\./, "") });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// udid → device name, cached for the server's lifetime (a simulator's name
// never changes under a fixed udid). Lets the preview page bake the device name
// into __SIM_PREVIEW__ so the client knows the device *type* on the first paint
// — otherwise `deviceType` defaults to "iphone" until the browser's async
// `simctl list` resolves, and an iPad frame renders at the iPhone size cap and
// then grows a few seconds later.
const deviceNameCache = new Map<string, string>();
function resolveDeviceName(udid: string): string | undefined {
  const cached = deviceNameCache.get(udid);
  if (cached !== undefined) return cached;
  for (const sim of listAllSimulators()) deviceNameCache.set(sim.udid, sim.name);
  return deviceNameCache.get(udid);
}

// Default per-simulator footprint when we have no running sim to measure
// from — a fresh booted iOS sim with one app launched typically sits in
// the 1.2–1.8 GB range. Used as a fallback only.
const DEFAULT_PER_SIM_BYTES = 1.5 * 1024 * 1024 * 1024;

interface MemoryReport {
  totalBytes: number;
  availableBytes: number;
  runningSimulators: number;
  perSimAvgBytes: number;
  perSimSource: "measured" | "estimated";
  estimatedAdditional: number;
}

function readSystemMemory(): { totalBytes: number; availableBytes: number } {
  try {
    const totalBytes = Number(
      execSync("sysctl -n hw.memsize", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      }).trim(),
    );
    const pageSize = Number(
      execSync("sysctl -n hw.pagesize", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      }).trim(),
    );
    const vmStat = execSync("vm_stat", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });
    const pages = (re: RegExp) => {
      const m = vmStat.match(re);
      return m ? Number(m[1]) : 0;
    };
    // "Available" mirrors what Activity Monitor treats as reclaimable: free
    // + inactive + speculative pages. Excludes wired and active.
    const availablePages =
      pages(/Pages free:\s+(\d+)/) +
      pages(/Pages inactive:\s+(\d+)/) +
      pages(/Pages speculative:\s+(\d+)/);
    return {
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
      availableBytes: availablePages * (Number.isFinite(pageSize) ? pageSize : 4096),
    };
  } catch {
    return { totalBytes: 0, availableBytes: 0 };
  }
}

// Sum RSS across every process whose argv path includes a CoreSimulator
// device directory. Groups by UDID so we get a real per-sim footprint that
// covers launchd_sim plus all child processes the runtime spawns.
function readSimulatorMemoryUsage(): { perUdid: Record<string, number>; totalBytes: number } {
  try {
    const output = execSync("ps -axo rss=,args=", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const perUdid: Record<string, number> = {};
    let totalBytes = 0;
    const re = /\/Devices\/([0-9A-F-]{36})\//i;
    for (const raw of output.split("\n")) {
      const line = raw.trimStart();
      if (!line) continue;
      const m = re.exec(line);
      if (!m) continue;
      const rssKb = Number(line.split(/\s+/, 1)[0]);
      if (!Number.isFinite(rssKb)) continue;
      const bytes = rssKb * 1024;
      const udid = m[1]!.toUpperCase();
      perUdid[udid] = (perUdid[udid] ?? 0) + bytes;
      totalBytes += bytes;
    }
    return { perUdid, totalBytes };
  } catch {
    return { perUdid: {}, totalBytes: 0 };
  }
}

function buildMemoryReport(): MemoryReport {
  const { totalBytes, availableBytes } = readSystemMemory();
  const usage = readSimulatorMemoryUsage();
  const runningSimulators = Object.keys(usage.perUdid).length;
  const measuredAvg = runningSimulators > 0
    ? usage.totalBytes / runningSimulators
    : 0;
  // Below ~256MB, the measurement is almost certainly catching a sim mid-boot
  // before its app processes are resident — fall back to the default so we
  // don't over-promise capacity.
  const perSimSource: MemoryReport["perSimSource"] =
    measuredAvg >= 256 * 1024 * 1024 ? "measured" : "estimated";
  const perSimAvgBytes =
    perSimSource === "measured" ? measuredAvg : DEFAULT_PER_SIM_BYTES;
  const estimatedAdditional = perSimAvgBytes > 0
    ? Math.max(0, Math.floor(availableBytes / perSimAvgBytes))
    : 0;
  return {
    totalBytes,
    availableBytes,
    runningSimulators,
    perSimAvgBytes,
    perSimSource,
    estimatedAdditional,
  };
}

/**
 * Pure core: resolve how to invoke the headless-serve-sim CLI from process
 * state — used both to spawn helpers (`--detach <udid>`) and to tell the
 * in-page tools how to shell out via /exec. Returns `{ command, baseArgs }`
 * ready for spawn(), or null when it can't be located. Order:
 *   1. Compiled standalone binary (`bun --compile`): argv[1] is a `/$bunfs/...`
 *      virtual path that doesn't exist on the real filesystem, so the binary
 *      itself (execPath, or a headless-serve-sim-named argv[0]) IS the CLI.
 *   2. argv[0] is the compiled binary directly (no bunfs entry in argv).
 *   3. `node /path/to/headless-serve-sim.js` (npm-installed / npx).
 *   4. `headless-serve-sim` on PATH (global install, or embedded in a host dev
 *      server whose argv is unrelated to us).
 */
export function resolveServeSimInvocation(
  argv: readonly string[],
  execPath: string,
  exists: (p: string) => boolean,
  lookupOnPath: () => string | null,
): { command: string; baseArgs: string[] } | null {
  const arg0 = argv[0] ?? "";
  const arg1 = argv[1] ?? "";
  const isOurName = (p: string) => /(^|\/)headless-serve-sim$/.test(p);

  if (arg1.startsWith("/$bunfs/")) {
    // Our compiled standalone binary: the /$bunfs/ entry is named after our
    // build outfile ("headless-serve-sim"), so the on-disk binary (execPath) IS
    // the CLI — even if the file was renamed after the build. A foreign
    // bun-compiled host that merely embeds our middleware has a different entry
    // name and a non-headless-serve-sim execPath, so it must NOT be run as our
    // CLI — fall through to PATH (or the explicit serveSimBin option).
    if ((isOurName(arg1) || isOurName(execPath)) && exists(execPath)) {
      return { command: execPath, baseArgs: [] };
    }
  } else if (isOurName(arg0) && exists(arg0)) {
    // argv[0] is the binary directly.
    return { command: arg0, baseArgs: [] };
  } else if (arg1 && /(^|\/)headless-serve-sim(\.js)?$/.test(arg1) && exists(arg1)) {
    // node/bun running our entry (headless-serve-sim.js), or a
    // node_modules/.bin/headless-serve-sim link (an executable without `.js`).
    return { command: arg0, baseArgs: [arg1] };
  }

  const onPath = lookupOnPath();
  if (onPath) return { command: onPath, baseArgs: [] };
  return null;
}

function lookupServeSimOnPath(): string | null {
  try {
    const path = execSync("command -v headless-serve-sim", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_500,
    }).trim();
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Locate the headless-serve-sim CLI for spawning helpers and for the in-page
 * tools. Thin process-bound wrapper over {@link resolveServeSimInvocation}.
 */
function resolveServeSimCommand(): { command: string; baseArgs: string[] } | null {
  return resolveServeSimInvocation(
    process.argv,
    process.execPath,
    existsSync,
    lookupServeSimOnPath,
  );
}

export interface SimMiddlewareOptions {
  /** Base path to serve the preview at. Default: "/.sim" */
  basePath?: string;
  /** Pin this preview server to a specific simulator UDID. */
  device?: string;
  /**
   * Per-session bearer token gating the `/exec` shell-exec route.
   * Auto-generated if omitted. The token is injected into the preview HTML
   * so the in-page UI can call `/exec` same-origin; LAN attackers and
   * cross-origin pages cannot read it.
   */
  execToken?: string;
  /**
   * Explicit command the in-page tools use to invoke the headless-serve-sim CLI
   * via /exec (an absolute path to the binary, or a `.js`/`.ts` entry the tools
   * wrap with node/bun). Defaults to auto-detection; set this when embedding in
   * a host dev server where auto-detection can't see our own entry.
   */
  serveSimBin?: string;
}

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  // `application/json; charset=utf-8` etc. — only the media type matters.
  const mediaType = value.split(";", 1)[0]!.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Connect-style middleware that serves the simulator preview UI.
 *
 * Routes handled under `basePath` (default `/.sim`):
 *   GET  {basePath}         — the preview HTML page
 *   GET  {basePath}/api     — headless-serve-sim state JSON
 *   GET  {basePath}/logs    — SSE stream of simctl logs
 *   GET  {basePath}/ax      — SSE stream of normalized accessibility snapshots
 */
export function simMiddleware(options?: SimMiddlewareOptions) {
  const base = (options?.basePath ?? "/.sim").replace(/\/+$/, "");
  // Per-process random token. Anyone who can read the preview HTML same-origin
  // can call /exec; cross-origin pages and LAN clients cannot, because they
  // can't read this value (it's only injected into the preview page's config).
  const execToken = options?.execToken ?? randomBytes(32).toString("base64url");
  // Resolved once per process: the command the in-page tools shell out to.
  const serveSimBin = options?.serveSimBin ?? serveSimBinPath();

  // Simulator-settings requests run in-process (just the underlying simctl /
  // ax-tool spawn) instead of round-tripping a full `node <cli>` exec per
  // sidebar interaction.
  const handleUiRequest: UiRequestHandler = async (payload) => {
    const p = (payload ?? {}) as { device?: string; option?: string; value?: string };
    if (typeof p.device !== "string" || !/^[0-9A-Za-z-]+$/.test(p.device)) {
      throw new Error("missing or invalid device udid");
    }
    if (p.option === undefined) {
      return { status: await getUiStatus(p.device) };
    }
    if (!UI_OPTIONS[p.option]) throw new Error(`unknown option: ${p.option}`);
    const value = typeof p.value === "string" ? normalizeUiValue(p.option, p.value) : null;
    if (value === null) throw new Error(`invalid value for ${p.option}: ${p.value}`);
    await setUiOption(p.device, p.option, value);
    return { ok: true };
  };

  const middleware = (req: SimReq, res: SimRes, next?: SimNext) => {
    const rawUrl: string = req.url ?? "";
    const qIndex = rawUrl.indexOf("?");
    const url = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
    const selectedDevice = queryDevice(rawUrl) ?? options?.device ?? null;
    const devtoolsFrontendBase = base === "/" ? "/devtools-frontend" : `${base}/devtools-frontend`;

    // Same-origin proxy for Chrome DevTools frontend assets. Loading the
    // appspot-hosted frontend directly works as a top-level tab, but is flaky
    // inside embedded browser iframes. Serving it from the preview origin keeps
    // the frontend's relative assets and CSP on the local page.
    if (url === devtoolsFrontendBase || url.startsWith(`${devtoolsFrontendBase}/`)) {
      (async () => {
        const assetPath = url === devtoolsFrontendBase
          ? "inspector.html"
          : url.slice(devtoolsFrontendBase.length + 1);
        // Reject path-traversal segments before they reach the upstream URL.
        if (assetPath.split("/").some((seg) => seg === "..")) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid asset path");
          return;
        }
        try {
          const upstream = await fetch(
            `https://chrome-devtools-frontend.appspot.com/serve_rev/@${DEVTOOLS_FRONTEND_REV}/${assetPath}${qIndex === -1 ? "" : rawUrl.slice(qIndex)}`,
          );
          const headers: Record<string, string> = {
            "Cache-Control": "public, max-age=604800",
          };
          const contentType = upstream.headers.get("content-type");
          if (contentType) headers["Content-Type"] = contentType;
          res.writeHead(upstream.status, headers);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (err) {
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(err instanceof Error ? err.message : "Failed to load DevTools frontend");
        }
      })();
      return;
    }

    // Serve the preview page
    if (url === base || url === base + "/") {
      const states = readServeSimStates();
      const state = selectServeSimState(states, selectedDevice);
      const baseHtml = loadHtml();

      const sendHtml = (html: string) => {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
      };

      if (!state) {
        // Empty-state UI still polls /exec (boot/list helpers), so the page
        // needs the bearer token even before a helper attaches. Inject a
        // minimal config with just the basePath + token.
        const minimal = htmlSafeJson({ basePath: base, execToken });
        sendHtml(
          baseHtml.replace(
            "<!--__SIM_PREVIEW_CONFIG__-->",
            `<script>window.__SIM_PREVIEW__=${minimal}</script>`,
          ),
        );
        return;
      }

      // Pull the helper's live screen config so __SIM_PREVIEW__ carries the real
      // device geometry — the frame then sizes correctly on the first paint
      // instead of rendering a generic fallback and resizing when the config
      // arrives over the control socket a moment later. Best-effort, so a slow
      // helper never blocks the page (fetchHelperScreenConfig resolves to null).
      (async () => {
        const remoteState = rewriteStateForRequestHost(state, req.headers?.host);
        const screenConfig = await fetchHelperScreenConfig(state.url);
        const deviceName = resolveDeviceName(state.device);
        const config = htmlSafeJson(
          previewConfigForState(remoteState, base, serveSimBin, execToken, screenConfig, deviceName),
        );
        sendHtml(
          baseHtml.replace(
            "<!--__SIM_PREVIEW_CONFIG__-->",
            `<script>window.__SIM_PREVIEW__=${config}</script>`,
          ),
        );
      })();
      return;
    }

    // Memory capacity estimate: how much room is left to boot more sims.
    if (url === base + "/grid/api/memory") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(buildMemoryReport()));
      return;
    }

    // Live per-app metrics: CPU% + RSS for the foreground app's host PID
    // (supplied by the client from the /appstate feed). Simulator apps are
    // ordinary host processes, so a plain `ps` reads them directly.
    if (url === base + "/api/metrics") {
      const query = qIndex === -1 ? "" : rawUrl.slice(qIndex + 1);
      const pid = Number(new URLSearchParams(query).get("pid"));
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      const result = Number.isInteger(pid) && pid > 0
        ? sampleAppMetrics(pid, Date.now())
        : { pid: 0, alive: false, rssBytes: null, cpuPercent: null };
      res.end(JSON.stringify(result));
      return;
    }

    // Grid JSON: every supported simulator, annotated with running helper info if any.
    if (url === base + "/grid/api") {
      const states = readServeSimStates();
      const helperByUdid = new Map(states.map((s) => [s.device, s] as const));
      const sims = listAllSimulators();
      const devices = sims.map((d) => {
        const helper = helperByUdid.get(d.udid);
        const remoteHelper = helper ? rewriteStateForRequestHost(helper, req.headers?.host) : null;
        return {
          device: d.udid,
          name: d.name,
          runtime: d.runtime,
          state: d.state,
          helper: remoteHelper
            ? {
                port: remoteHelper.port,
                url: remoteHelper.url,
                streamUrl: remoteHelper.streamUrl,
                wsUrl: remoteHelper.wsUrl,
              }
            : null,
        };
      });
      // Stable order: family (iPhone, iPad, Watch, TV, Vision, other) →
      // state (helper > booted > shutdown) → alpha. Keeps the most
      // commonly used devices visible without scrolling.
      const familyRank = (name: string): number => {
        if (/iphone/i.test(name)) return 0;
        if (/ipad/i.test(name)) return 1;
        if (/watch/i.test(name)) return 2;
        if (/(apple\s*tv|^tv\b)/i.test(name)) return 3;
        if (/vision|reality/i.test(name)) return 4;
        return 5;
      };
      const stateRank = (x: typeof devices[number]) =>
        x.helper ? 0 : x.state === "Booted" ? 1 : 2;
      devices.sort((a, b) =>
        familyRank(a.name) - familyRank(b.name) ||
        stateRank(a) - stateRank(b) ||
        a.name.localeCompare(b.name),
      );
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ devices }));
      return;
    }

    // Shutdown a booted simulator. Any running helper for the device is reaped
    // by readServeSimStates() on the next /grid/api poll (it kills helpers
    // whose backing simulator is no longer in the booted set).
    if (url === base + "/grid/api/shutdown" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString();
      });
      req.on("end", () => {
        let udid = "";
        try { udid = (JSON.parse(body) as ShutdownRequestBody).udid ?? ""; } catch {}
        if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(udid)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid or missing udid" }));
          return;
        }
        // Drop the snapshot so the next /grid/api call re-queries simctl
        // and prunes any helper bound to this now-shutdown device.
        bootedSnapshot = { at: 0, booted: null };
        execFile("xcrun", ["simctl", "shutdown", udid], { timeout: 30_000 }, (err, _stdout, stderr) => {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: false,
              error: stderr?.toString().trim() || err.message,
            }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      });
      return;
    }

    // Spawn a headless-serve-sim helper (auto-boots if needed).
    if (url === base + "/grid/api/start" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString();
      });
      req.on("end", () => {
        let udid = "";
        try { udid = (JSON.parse(body) as StartRequestBody).udid ?? ""; } catch {}
        if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(udid)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid or missing udid" }));
          return;
        }
        const resolved = resolveServeSimCommand();
        if (!resolved) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: false,
            error: "headless-serve-sim CLI not found in PATH. Install it (npm i -g headless-serve-sim) and retry.",
          }));
          return;
        }
        const child = spawn(
          resolved.command,
          [...resolved.baseArgs, "--detach", udid],
          { stdio: ["ignore", "pipe", "pipe"], detached: false },
        );
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
        child.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
        // A cold iOS simulator can take 60-90s to reach `bootstatus -b`
        // readiness; the prior 60s ceiling was killing headless-serve-sim mid-boot
        // and the helper never got a chance to spawn, so the click ended
        // with an error and no state file. 3 minutes is a comfortable
        // upper bound that covers slow first-boots without leaving a
        // wedged child around indefinitely.
        const timer = setTimeout(() => {
          try { child.kill("SIGTERM"); } catch {}
        }, 180_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, stdout: stdout.trim() }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: false,
              error: stderr.trim() || stdout.trim() || `headless-serve-sim exited with code ${code}`,
            }));
          }
        });
      });
      return;
    }

    // JSON API: start the inspect-webkit CDP bridge and list WebKit targets
    // for the selected simulator. The bridge itself serves /json/list and
    // /devtools/page/:id on localhost; the preview adds iframe-safe frontend
    // URLs so the browser UI can embed Chrome DevTools.
    if (url === base + "/devtools") {
      (async () => {
        const states = readServeSimStates();
        const state = selectServeSimState(states, selectedDevice);
        if (!state) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No headless-serve-sim device" }));
          return;
        }
        try {
          const bridge = await ensureInspectWebKitBridge();
          const bridgeTargets = await bridge.listTargets();
          const wsHost = bridgeWsHost(req.headers?.host, bridge.port);
          // inspect-webkit@0.0.3 only exposes `sim:<webinspectord-pid>` for
          // simulator targets, which can't be reconciled against a sim UDID.
          // Surface every booted sim's targets (Safari Develop-menu behavior)
          // until inspect-webkit grows a real UDID we can filter on.
          const targets = bridgeTargets.map((target) => ({
            ...target,
            webSocketDebuggerUrl: `ws://${wsHost}/devtools/page/${encodeURIComponent(target.id)}`,
            devtoolsFrontendUrl: devtoolsFrontendUrl(devtoolsFrontendBase, wsHost, target.id),
          }));
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({
            port: bridge.port,
            targets,
          }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : "Failed to start inspect-webkit",
          }));
        }
      })();
      return;
    }

    // POST /devtools/release — drop hover-highlight CDP sessions so we don't
    // sit on a WIR slot when the picker is dismissed (or the tab is closed).
    // Optional body { targetId } releases just one; empty body releases all.
    if (url === base + "/devtools/release" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed: ReleaseRequestBody = body ? JSON.parse(body) : {};
          const bridge = await ensureInspectWebKitBridge();
          bridge.releaseHighlight?.(parsed.targetId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : "Failed to release",
          }));
        }
      });
      return;
    }

    // POST /devtools/highlight — flash an inspectable target in the
    // simulator the way Safari's Develop menu hover does. Body shape:
    // { targetId: string, on: boolean }.
    if (url === base + "/devtools/highlight" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", async () => {
        try {
          const { targetId, on } = JSON.parse(body || "{}") as HighlightRequestBody;
          if (!targetId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing targetId" }));
            return;
          }
          const bridge = await ensureInspectWebKitBridge();
          if (!bridge.highlightTarget) {
            res.writeHead(501, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "highlightTarget not supported by inspect-webkit" }));
            return;
          }
          await bridge.highlightTarget(targetId, !!on);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : "Failed to highlight target",
          }));
        }
      });
      return;
    }

    // JSON API: headless-serve-sim state
    if (url === base + "/api") {
      const states = readServeSimStates();
      const state = selectServeSimState(states, selectedDevice);
      // The web UI polls /api every ~2s, so logging every hit floods the
      // debug stream with identical lines. Only log when the selection
      // result changes.
      const apiLogKey = `${selectedDevice ?? "(any)"}|${states.length}|${
        state ? `${state.device}@${state.port}` : "none"
      }`;
      if (apiLogKey !== lastApiLogKey) {
        lastApiLogKey = apiLogKey;
        debugMw(
          "GET /api selectedDevice=%s states=%d chose=%s",
          selectedDevice ?? "(any)",
          states.length,
          state ? `${state.device}@${state.port}` : "none",
        );
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      const remoteState = state ? rewriteStateForRequestHost(state, req.headers?.host) : null;
      res.end(JSON.stringify(remoteState ? previewConfigForState(remoteState, base, serveSimBin, execToken) : null));
      return;
    }

    // SSE: headless-serve-sim state stream. Push replacement for the web UI's old ~1.5s
    // /api poll — the PreviewConfig only changes when a helper boots/shuts down
    // or the device selection changes, so we watch the state dir and emit only
    // on change instead of re-sending identical JSON on a fixed interval.
    if (url === base + "/api/events") {
      const computeConfig = (): string => {
        const states = readServeSimStates();
        const state = selectServeSimState(states, selectedDevice);
        const remoteState = state ? rewriteStateForRequestHost(state, req.headers?.host) : null;
        return JSON.stringify(
          remoteState ? previewConfigForState(remoteState, base, serveSimBin, execToken) : null,
        );
      };

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");

      let lastSent = computeConfig();
      res.write("data: " + lastSent + "\n\n");

      let closed = false;
      const sendIfChanged = () => {
        if (closed || res.writableEnded) return;
        const next = computeConfig();
        if (next === lastSent) return;
        lastSent = next;
        res.write("data: " + next + "\n\n");
      };

      // Debounce filesystem events: a helper boot rewrites the state file a few
      // times in quick succession, and selectServeSimState also shells out to
      // refresh booted devices, so coalesce bursts into one recompute.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onFsEvent = () => {
        if (debounce) return;
        debounce = setTimeout(() => {
          debounce = null;
          sendIfChanged();
        }, 150);
      };

      let watcher: FSWatcher | null = null;
      let watcherRetry: ReturnType<typeof setTimeout> | null = null;
      const ensureWatcher = () => {
        if (closed || res.writableEnded || watcher || watcherRetry) return;
        watcherRetry = setTimeout(() => {
          watcherRetry = null;
          if (closed || res.writableEnded || watcher) return;
          try {
            watcher = watch(STATE_DIR, onFsEvent);
            watcher.on("error", () => {
              watcher?.close();
              watcher = null;
              ensureWatcher();
            });
            sendIfChanged();
          } catch {
            ensureWatcher();
          }
        }, 250);
      };
      ensureWatcher();

      // Keep the connection alive through buffering proxies + catch any change
      // an fs event missed (e.g. dir created after we failed to watch it).
      const heartbeat = setInterval(() => {
        if (closed || res.writableEnded) return;
        res.write(":\n\n");
        ensureWatcher();
      }, 15000);

      req.on("close", () => {
        closed = true;
        if (debounce) clearTimeout(debounce);
        if (watcherRetry) clearTimeout(watcherRetry);
        clearInterval(heartbeat);
        watcher?.close();
      });
      return;
    }

    // SSE: normalized accessibility snapshot stream
    if (url === base + "/ax") {
      const states = readServeSimStates();
      const state = selectServeSimState(states, selectedDevice);
      if (!state) {
        res.writeHead(404);
        res.end("No headless-serve-sim device");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");
      axStreamerCache.prune(states.map((s) => s.device));
      const ax = axStreamerCache.get(state.device, state.port);
      const removeClient = ax.addClient(res);
      req.on("close", removeClient);
      return;
    }

    // POST /exec — run a shell command on the host. Gated by a per-process
    // bearer token injected only into the same-origin preview HTML, with
    // Content-Type + Origin checks to block CORS-simple CSRF (a malicious
    // page POSTing `text/plain` JSON to a dev server bound to a public iface)
    // and LAN attackers who can reach the port but can't read the token.
    if ((url === base + "/exec" || url === base + "/exec/") && req.method === "POST") {
      // 1. Reject anything that isn't a JSON request, killing the
      //    `enctype="text/plain"` CORS-simple form-POST path.
      if (!isJsonContentType(req.headers["content-type"])) {
        res.writeHead(415, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stdout: "", stderr: "Unsupported Media Type", exitCode: 1 }));
        return;
      }
      // 2. If the browser supplied an Origin, require it match this server.
      //    Same-origin XHR from the preview page sets Origin to our own URL;
      //    a cross-origin page's Origin won't match.
      const origin = req.headers.origin;
      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== req.headers.host) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ stdout: "", stderr: "Cross-origin request blocked", exitCode: 1 }));
            return;
          }
        } catch {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stdout: "", stderr: "Invalid Origin", exitCode: 1 }));
          return;
        }
      }
      // 3. Require the per-session bearer token. Cross-origin pages cannot
      //    read it from window.__SIM_PREVIEW__; non-browser callers must
      //    have copied it from the CLI output.
      const authHeader = req.headers.authorization ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (!match || !safeEqualString(match[1]!.trim(), execToken)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stdout: "", stderr: "Unauthorized", exitCode: 1 }));
        return;
      }
      let body = "";
      let aborted = false;
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString();
        // Cheap belt-and-braces cap so a runaway POST can't OOM the dev server.
        if (body.length > 4 * 1024 * 1024) {
          aborted = true;
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stdout: "", stderr: "Payload Too Large", exitCode: 1 }));
          req.destroy();
        }
      });
      req.on("end", () => {
        if (aborted) return;
        let command = "";
        try {
          command = (JSON.parse(body) as ExecRequestBody).command ?? "";
        } catch {}
        if (!command) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stdout: "", stderr: "Missing command", exitCode: 1 }));
          return;
        }
        exec(command, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: err ? (err as ExecException).code ?? 1 : 0,
          }));
        });
      });
      return;
    }

    // SSE: simctl log stream
    if (url === base + "/logs") {
      const states = readServeSimStates();
      const state = selectServeSimState(states, selectedDevice);
      if (!state) {
        res.writeHead(404);
        res.end("No headless-serve-sim device");
        return;
      }
      const udid = state.device;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");

      const child: ChildProcess = spawn("xcrun", [
        "simctl", "spawn", udid, "log", "stream",
        "--style", "ndjson",
        "--level", "info",
      ], { stdio: ["ignore", "pipe", "ignore"] });

      let buf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) res.write("data: " + line + "\n\n");
        }
        // Drop a runaway partial line so a malformed/never-terminated
        // log entry can't grow `buf` without bound.
        if (buf.length > SSE_LINE_BUFFER_LIMIT) buf = "";
      });

      child.on("error", () => { try { res.end(); } catch {} });
      child.on("close", () => res.end());
      req.on("close", () => {
        child.stdout?.destroy();
        child.kill();
      });
      return;
    }

    // SSE: foreground-app change stream. Emits `{bundleId, pid}` events
    // parsed from SpringBoard's "Setting process visibility to: Foreground"
    // log line. Filtering is done here (not in the browser) so the SSE stream
    // stays narrow and the client can listen without rate-limit concerns.
    if (url === base + "/appstate") {
      const states = readServeSimStates();
      const state = selectServeSimState(states, selectedDevice);
      if (!state) {
        res.writeHead(404);
        res.end("No headless-serve-sim device");
        return;
      }
      const udid = state.device;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");

      // Bootstrap: SpringBoard's log feed is edge-triggered, so a fresh
      // subscriber would otherwise see nothing until the user re-foregrounds
      // an app (the bug: tools couldn't reconnect after a page reload). Ask
      // the helper's AX bridge for the current frontmost app via
      // `proc_pidpath`+Info.plist resolution and emit it before tailing.
      let lastBundle = "";
      void (async () => {
        // The bootstrap is the ONLY way to surface an already-foreground app
        // (page opened/reconnected after the app launched — the SpringBoard
        // feed is edge-triggered and emits nothing until the next switch). A
        // single shot was fragile: the helper may still be coming up, or its AX
        // bridge briefly busy under a heavy RN app, and the 1.5s probe aborts —
        // stranding the UI on "waiting for an app to come to the foreground"
        // (and, downstream, leaving the Activity charts without a pid). Retry a
        // few times with backoff; stop once we emit or the log tail beats us.
        for (let attempt = 0; attempt < 6; attempt++) {
          if (res.writableEnded || lastBundle) return;
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 1500);
            const r = await fetch(`http://127.0.0.1:${state.port}/foreground`, { signal: ctrl.signal });
            clearTimeout(timer);
            if (r.ok) {
              const info = await r.json() as { bundleId?: string; pid?: number };
              if (info.bundleId && isUserFacingBundle(info.bundleId)) {
                if (res.writableEnded || lastBundle) return;
                lastBundle = info.bundleId;
                const isReactNative = await detectReactNative(udid, info.bundleId);
                if (res.writableEnded) return;
                res.write("data: " + JSON.stringify({ bundleId: info.bundleId, pid: info.pid, isReactNative }) + "\n\n");
                return;
              }
            }
          } catch {
            // Helper not ready yet — fall through to the backoff and retry.
          }
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      })();

      const child: ChildProcess = spawn("xcrun", [
        "simctl", "spawn", udid, "log", "stream",
        "--style", "ndjson",
        "--level", "info",
        "--predicate",
        'process == "SpringBoard" AND eventMessage CONTAINS "Setting process visibility to: Foreground"',
      ], { stdio: ["ignore", "pipe", "ignore"] });

      let closed = false;
      const emitApp = async (bundleId: string, pid?: number) => {
        if (!isUserFacingBundle(bundleId)) return;
        if (bundleId === lastBundle) return;
        lastBundle = bundleId;
        const isReactNative = await detectReactNative(udid, bundleId);
        if (!closed) {
          res.write("data: " + JSON.stringify({ bundleId, pid, isReactNative }) + "\n\n");
        }
      };


      let buf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg: string;
          try { msg = JSON.parse(line).eventMessage ?? ""; } catch { continue; }
          const event = parseForegroundAppLogMessage(msg);
          if (!event) continue;
          emitApp(event.bundleId, event.pid);
        }
        if (buf.length > SSE_LINE_BUFFER_LIMIT) buf = "";
      });

      child.on("error", () => {
        closed = true;
        try { res.end(); } catch {}
      });
      child.on("close", () => res.end());
      req.on("close", () => {
        closed = true;
        child.stdout?.destroy();
        child.kill();
      });
      return;
    }

    // Not ours — pass through
    if (next) next();
  };

  // WebSocket exec channel — same auth/origin policy as POST /exec, but off
  // the browser's per-origin HTTP connection pool so multiple preview tabs
  // (each holding MJPEG + SSE streams) can't starve actions. The built-in
  // preview server forwards `upgrade` events here. Existing in-page tools keep
  // using POST /exec; only the simulator-settings panel rides this channel.
  return Object.assign(middleware, {
    handleUpgrade: createExecUpgradeHandler({
      path: `${base}/exec-ws`,
      execToken,
      onUiRequest: handleUiRequest,
    }),
  });
}
