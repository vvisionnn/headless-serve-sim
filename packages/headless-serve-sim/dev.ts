#!/usr/bin/env bun
/**
 * Dev server for the headless-serve-sim preview UI (the same client that ships inlined
 * in `headless-serve-sim`). Iterate on src/client/ with live rebuild.
 *
 * Run: bun --watch dev.ts
 */
import { readdirSync, readFileSync, existsSync, unlinkSync, watch } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import tailwindPlugin from "bun-plugin-tailwind";
import { createAxStreamerCache } from "./src/ax";
import { resolveInstalledDeviceMetadata } from "./src/device-metadata";
import {
  buildSimLogStreamArgs,
  createSimLogLineFramer,
  parseSimLogLevel,
  parseSimLogProcessId,
} from "./src/sim-log-stream";
import type { CommandResult, HostCommands } from "./src/runtime/host-commands";
import { createNodeHostCommands } from "./src/runtime/node-host-commands";

const RN_BUNDLE_IDS = new Set<string>(["host.exp.Exponent", "dev.expo.Exponent"]);
const RN_MARKERS = [
  "Frameworks/React.framework",
  "Frameworks/hermes.framework",
  "Frameworks/Hermes.framework",
  "Frameworks/ExpoModulesCore.framework",
  "main.jsbundle",
];

function commandSucceeded(result: CommandResult): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut;
}

async function detectReactNative(
  hostCommands: HostCommands,
  udid: string,
  bundleId: string,
): Promise<boolean> {
  if (RN_BUNDLE_IDS.has(bundleId)) return Promise.resolve(true);
  const result = await hostCommands.run({
    executable: "xcrun",
    args: ["simctl", "get_app_container", udid, bundleId, "app"],
    stdio: "capture",
    timeoutMs: 2_000,
  });
  if (!commandSucceeded(result)) return false;
  const appPath = result.stdout.toString().trim();
  return !!appPath && RN_MARKERS.some((marker) => existsSync(join(appPath, marker)));
}
const NON_UI_BUNDLE_RE =
  /(WidgetRenderer|ExtensionHost|\.extension(\.|$)|Service|PlaceholderApp|InCallService|CallUI|InCallUI|com\.apple\.Preferences\.Cellular|com\.apple\.purplebuddy|com\.apple\.chrono|com\.apple\.shuttle|com\.apple\.usernotificationsui)/i;
function isUserFacingBundle(bundleId: string): boolean {
  return !NON_UI_BUNDLE_RE.test(bundleId);
}

const PORT = Number(process.env.PORT) || 3200;
const STATE_DIR = join(tmpdir(), "headless-serve-sim");
const CLIENT_DIR = resolve(import.meta.dir, "src/client");
const CLIENT_ENTRY = resolve(CLIENT_DIR, "client.tsx");
const PKG_ROOT = resolve(import.meta.dir);
const SERVE_SIM_BIN_CANDIDATES = [
  join(PKG_ROOT, "src", "index.ts"),
  join(PKG_ROOT, "dist", "headless-serve-sim.js"),
];
function resolveServeSimBin(): string {
  for (const p of SERVE_SIM_BIN_CANDIDATES) if (existsSync(p)) return p;
  return "headless-serve-sim";
}
const SERVE_SIM_BIN = resolveServeSimBin();
const axStreamerCache = createAxStreamerCache();

export interface DevServerDependencies {
  hostCommands: HostCommands;
  stateDir: string;
  serveSimBin: string;
  resolveDeviceMetadata: typeof resolveInstalledDeviceMetadata;
  now?: () => number;
}

type ServeSimState = {
  pid: number;
  port: number;
  device: string;
  url: string;
  streamUrl: string;
  wsUrl: string;
};

// ─── Serve-sim state ───

type BootedSnapshot = { at: number; booted: Set<string> | null };

function getBootedUdids(
  hostCommands: HostCommands,
  snapshot: BootedSnapshot,
  now: number,
): Set<string> | null {
  if (snapshot.booted && now - snapshot.at < 1500) {
    return snapshot.booted;
  }
  try {
    const result = hostCommands.run(
      {
        executable: "xcrun",
        args: ["simctl", "list", "devices", "booted", "-j"],
        stdio: "capture",
        timeoutMs: 3_000,
      },
      "sync",
    );
    if (!commandSucceeded(result)) return null;
    const output = result.stdout.toString();
    const data = JSON.parse(output) as {
      devices: Record<string, Array<{ udid: string; state: string }>>;
    };
    const booted = new Set<string>();
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.state === "Booted") booted.add(device.udid);
      }
    }
    snapshot.at = now;
    snapshot.booted = booted;
    return booted;
  } catch {
    return null;
  }
}

function readServeSimStates(
  hostCommands: HostCommands,
  stateDir: string,
  snapshot: BootedSnapshot,
  now: number,
): ServeSimState[] {
  let files: string[];
  try {
    files = readdirSync(stateDir).filter((f) => f.startsWith("server-") && f.endsWith(".json"));
  } catch {
    return [];
  }
  const booted = getBootedUdids(hostCommands, snapshot, now);
  const states: ServeSimState[] = [];
  for (const f of files) {
    const path = join(stateDir, f);
    try {
      const state = JSON.parse(readFileSync(path, "utf-8")) as ServeSimState;
      if (!hostCommands.signal(state.pid, 0)) {
        try {
          unlinkSync(path);
        } catch {}
        continue;
      }
      // Helper alive but bound to a shutdown simulator — the Swift helper
      // keeps accepting MJPEG connections and /health returns OK, but no
      // frames ever flow. Recycle so a fresh helper is spawned on demand.
      if (booted && !booted.has(state.device)) {
        console.error(
          `\x1b[33m[headless-serve-sim] Recycling stale helper pid ${state.pid} — device ${state.device} is no longer booted.\x1b[0m`,
        );
        hostCommands.signal(state.pid, "SIGTERM");
        try {
          unlinkSync(path);
        } catch {}
        continue;
      }
      states.push(state);
    } catch {}
  }
  return states;
}

function selectServeSimState(
  states: ServeSimState[],
  device?: string | null,
): ServeSimState | null {
  if (!device) return null;
  return states.find((state) => state.device === device) ?? null;
}

function endpoint(path: string, device: string): string {
  return `/${path}?device=${encodeURIComponent(device)}`;
}

function htmlSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function previewConfigForState(dependencies: DevServerDependencies, state: ServeSimState) {
  const deviceMetadata = await dependencies.resolveDeviceMetadata(state.device);
  return {
    ...state,
    ...deviceMetadata,
    basePath: "/",
    logsEndpoint: endpoint("logs", state.device),
    appStateEndpoint: endpoint("appstate", state.device),
    metricsEndpoint: endpoint("api/metrics", state.device),
    axEndpoint: endpoint("ax", state.device),
    serveSimBin: dependencies.serveSimBin,
  };
}

// ─── Client bundler with watch ───

let clientJs = "";
let clientError = "";
let tailwindCss = "";
const reloadClients = new Set<ReadableStreamDefaultController>();
let lastTailwindContentSignature = "";
let pendingClientBuild = false;
let pendingTailwindBuild = false;
let buildTimer: ReturnType<typeof setTimeout> | null = null;

function signalReload() {
  for (const ctrl of reloadClients) {
    try {
      ctrl.enqueue("data: reload\n\n");
    } catch {
      reloadClients.delete(ctrl);
    }
  }
}

async function buildClient() {
  const start = performance.now();
  const result = await Bun.build({
    entrypoints: [CLIENT_ENTRY],
    minify: false,
    target: "browser",
    format: "esm",
    define: {
      "process.env.NODE_ENV": '"development"',
    },
  });
  if (result.success) {
    clientJs = (await result.outputs[0]!.text()).replace(/<\/script>/gi, "<\\/script>");
    clientError = "";
    const ms = (performance.now() - start).toFixed(0);
    console.log(
      `\x1b[32m✓\x1b[0m Bundled client.tsx (${(clientJs.length / 1024).toFixed(0)} KB) in ${ms}ms`,
    );
  } else {
    clientError = result.logs.map((l) => String(l)).join("\n");
    console.error("\x1b[31m✗\x1b[0m Build failed:\n" + clientError);
  }
  signalReload();
}

function cssCommentEscape(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/</g, "\\3C ");
}

async function buildTailwindCss() {
  const start = performance.now();
  try {
    const result = await Bun.build({
      entrypoints: [resolve(CLIENT_DIR, "global.css")],
      minify: false,
      plugins: [tailwindPlugin],
    });
    if (result.success) {
      tailwindCss = await result.outputs[0]!.text();
      const ms = (performance.now() - start).toFixed(0);
      console.log(
        `\x1b[32m✓\x1b[0m Bundled global.css (${(tailwindCss.length / 1024).toFixed(0)} KB) in ${ms}ms`,
      );
    } else {
      const err = result.logs.map((l) => String(l)).join("\n");
      console.error("\x1b[31m✗\x1b[0m Tailwind build failed:\n" + err);
      tailwindCss = `/* tailwind build failed: ${cssCommentEscape(err)} */`;
    }
  } catch (e) {
    console.error("\x1b[31m✗\x1b[0m Tailwind build threw:", e);
    tailwindCss = `/* tailwind build threw: ${cssCommentEscape(String(e))} */`;
  }
  signalReload();
}

function listClientFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listClientFiles(path));
    } else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

function readTailwindContentSignature(): string {
  const parts: string[] = [];
  for (const path of listClientFiles(CLIENT_DIR)) {
    const text = readFileSync(path, "utf-8");
    if (/\.css$/.test(path)) {
      parts.push(path, text);
      continue;
    }
    const stringLiterals = text.match(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? [];
    parts.push(path, stringLiterals.join("\n"));
  }
  return parts.join("\n");
}

function tailwindContentChanged(): boolean {
  const next = readTailwindContentSignature();
  if (next === lastTailwindContentSignature) return false;
  lastTailwindContentSignature = next;
  return true;
}

function scheduleWatchedBuild() {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    buildTimer = null;
    const shouldBuildClient = pendingClientBuild;
    const contentChanged = tailwindContentChanged();
    const shouldBuildTailwind = pendingTailwindBuild || (pendingClientBuild && contentChanged);
    pendingClientBuild = false;
    pendingTailwindBuild = false;
    if (shouldBuildClient) void buildClient();
    if (shouldBuildTailwind) void buildTailwindCss();
  }, 75);
}

// ─── HTML shell ───

async function buildHtml(
  dependencies: DevServerDependencies,
  readStates: () => ServeSimState[],
  selectedDevice?: string | null,
): Promise<string> {
  const states = readStates();
  const state = selectServeSimState(states, selectedDevice);
  const configScript = state
    ? `<script>window.__SIM_PREVIEW__=${htmlSafeJson(await previewConfigForState(dependencies, state))}</script>`
    : "";

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>headless-serve-sim dev</title>
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}</style>
<style>${tailwindCss}</style>
</head><body>
<div id="root"></div>
${configScript}
<script type="module">${clientJs}</script>
<script>
// Auto-reload on rebuild
const es = new EventSource("/__dev/reload");
es.onmessage = (e) => { if (e.data === "reload") location.reload(); };
</script>
${clientError ? `<pre style="position:fixed;inset:0;z-index:9999;background:#1a0000;color:#ff6b6b;padding:24px;margin:0;font-size:13px;overflow:auto;white-space:pre-wrap">${clientError.replace(/</g, "&lt;")}</pre>` : ""}
</body></html>`;
}

// ─── Server ───

export function createDevFetchHandler(dependencies: DevServerDependencies) {
  const bootedSnapshot: BootedSnapshot = { at: 0, booted: null };
  const now = dependencies.now ?? Date.now;
  const readStates = () =>
    readServeSimStates(dependencies.hostCommands, dependencies.stateDir, bootedSnapshot, now());

  return async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const selectedDevice = url.searchParams.get("device");

    // Dev reload SSE
    if (url.pathname === "/__dev/reload") {
      const stream = new ReadableStream({
        start(controller) {
          reloadClients.add(controller);
          controller.enqueue(":\n\n");
        },
        cancel(controller) {
          reloadClients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Serve-sim state API
    if (url.pathname === "/api") {
      const states = readStates();
      const state = selectServeSimState(states, selectedDevice);
      return Response.json(state ? await previewConfigForState(dependencies, state) : null, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (url.pathname === "/ax") {
      const states = readStates();
      const state = selectServeSimState(states, selectedDevice);
      if (!state) {
        return new Response("No headless-serve-sim device", { status: 404 });
      }
      const ax = axStreamerCache.get(state.device, state.port);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(":\n\n");
          const removeClient = ax.addClient({
            write(chunk: string) {
              controller.enqueue(chunk);
            },
          });
          req.signal.addEventListener("abort", removeClient);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (url.pathname === "/grid/api/start" && req.method === "POST") {
      return req.json().then((body: any) => {
        const udid: string = body?.udid ?? "";
        if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(udid)) {
          return Response.json({ ok: false, error: "Invalid or missing udid" }, { status: 400 });
        }
        return new Promise<Response>((resolve) => {
          const child = dependencies.hostCommands.start({
            executable: "bun",
            args: [dependencies.serveSimBin, "--detach", udid],
            stdio: "stream",
          });
          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (c: Buffer) => {
            stdout += c.toString();
          });
          child.stderr?.on("data", (c: Buffer) => {
            stderr += c.toString();
          });
          const timer = setTimeout(() => child.stop("SIGTERM"), 180_000);
          void child.result
            .then((result) => {
              clearTimeout(timer);
              if (commandSucceeded(result)) {
                resolve(Response.json({ ok: true, stdout: stdout.trim() }));
              } else {
                resolve(
                  Response.json(
                    {
                      ok: false,
                      error:
                        stderr.trim() ||
                        stdout.trim() ||
                        `headless-serve-sim exited with code ${result.exitCode}`,
                    },
                    { status: 500 },
                  ),
                );
              }
            })
            .catch((error: unknown) => {
              clearTimeout(timer);
              resolve(
                Response.json(
                  {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  { status: 500 },
                ),
              );
            });
        });
      });
    }

    if (url.pathname === "/grid/api/shutdown" && req.method === "POST") {
      return req.json().then((body: any) => {
        const udid: string = body?.udid ?? "";
        if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(udid)) {
          return Response.json({ ok: false, error: "Invalid or missing udid" }, { status: 400 });
        }
        bootedSnapshot.at = 0;
        bootedSnapshot.booted = null;
        return dependencies.hostCommands
          .run({
            executable: "xcrun",
            args: ["simctl", "shutdown", udid],
            stdio: "capture",
            timeoutMs: 30_000,
          })
          .then((result) =>
            commandSucceeded(result)
              ? Response.json({ ok: true })
              : Response.json(
                  {
                    ok: false,
                    error: result.stderr.toString().trim() || "simctl shutdown failed",
                  },
                  { status: 500 },
                ),
          );
      });
    }

    if (url.pathname.startsWith("/grid/api/")) {
      return Response.json(
        { ok: false, error: `Unknown dev endpoint: ${url.pathname}` },
        { status: 404 },
      );
    }

    // POST /exec — run a shell command and return stdout/stderr/exitCode.
    if (url.pathname === "/exec" && req.method === "POST") {
      return req.json().then((body: any) => {
        const command: string = body?.command ?? "";
        if (!command) {
          return Response.json(
            { stdout: "", stderr: "Missing command", exitCode: 1 },
            { status: 400 },
          );
        }
        return dependencies.hostCommands
          .run({
            shell: command,
            stdio: "capture",
            maxOutputBytes: 16 * 1024 * 1024,
          })
          .then((result) =>
            Response.json({
              stdout: result.stdout.toString(),
              stderr: result.stderr.toString(),
              exitCode: result.exitCode ?? 1,
            }),
          );
      });
    }

    // SSE logs
    if (url.pathname === "/logs") {
      const level = parseSimLogLevel(url.searchParams.get("level"));
      if (!level) {
        return new Response("Invalid log level", { status: 400 });
      }
      const processId = parseSimLogProcessId(url.searchParams.get("processId"));
      if (processId === undefined) {
        return new Response("Invalid process id", { status: 400 });
      }
      const states = readStates();
      const state = selectServeSimState(states, selectedDevice);
      if (!state) {
        return new Response("No headless-serve-sim device", { status: 404 });
      }
      const udid = state.device;
      const stream = new ReadableStream({
        start(controller) {
          const child = dependencies.hostCommands.start({
            executable: "xcrun",
            args: buildSimLogStreamArgs(udid, level, processId),
            stdio: "stream",
          });
          const framer = createSimLogLineFramer();

          child.stdout!.on("data", (chunk: Buffer | string) => {
            const lines = framer.push(typeof chunk === "string" ? chunk : chunk.toString());
            for (const line of lines) {
              try {
                controller.enqueue(`data: ${line}\n\n`);
              } catch {
                child.stop();
              }
            }
          });
          void child.result.then(() => {
            try {
              controller.close();
            } catch {}
          });
          // Clean up when client disconnects
          req.signal.addEventListener("abort", () => child.stop());
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // SSE foreground-app changes (filtered in the CLI; browser just listens).
    if (url.pathname === "/appstate") {
      const states = readStates();
      const state = selectServeSimState(states, selectedDevice);
      if (!state) {
        return new Response("No headless-serve-sim device", { status: 404 });
      }
      const udid = state.device;
      const stream = new ReadableStream({
        start(controller) {
          const child = dependencies.hostCommands.start({
            executable: "xcrun",
            args: [
              "simctl",
              "spawn",
              udid,
              "log",
              "stream",
              "--style",
              "ndjson",
              "--level",
              "info",
              "--predicate",
              'process == "SpringBoard" AND eventMessage CONTAINS "Setting process visibility to: Foreground"',
            ],
            stdio: "stream",
          });
          const FG_RE = /\[app<([^>]+)>:(\d+)\] Setting process visibility to: Foreground/;
          let lastBundle = "";
          let buf = "";
          child.stdout!.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let msg: string;
              try {
                msg = JSON.parse(line).eventMessage ?? "";
              } catch {
                continue;
              }
              const m = FG_RE.exec(msg);
              if (!m) continue;
              const bundleId = m[1]!;
              const pid = parseInt(m[2]!, 10);
              if (!isUserFacingBundle(bundleId)) continue;
              if (bundleId === lastBundle) continue;
              lastBundle = bundleId;
              detectReactNative(dependencies.hostCommands, udid, bundleId).then((isReactNative) => {
                try {
                  controller.enqueue(
                    `data: ${JSON.stringify({ bundleId, pid, isReactNative })}\n\n`,
                  );
                } catch {
                  child.stop();
                }
              });
            }
          });
          void child.result.then(() => {
            try {
              controller.close();
            } catch {}
          });
          req.signal.addEventListener("abort", () => child.stop());
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Same device-scoped native metrics proxy as production middleware.
    if (url.pathname === "/api/metrics") {
      const state = selectServeSimState(readStates(), selectedDevice);
      if (!state) {
        return Response.json(
          { error: "No headless-serve-sim device" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      try {
        const upstream = await fetch(`http://127.0.0.1:${state.port}/metrics`, {
          cache: "no-store",
          signal: AbortSignal.timeout(2_000),
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("content-type") ?? "application/json",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return Response.json(
          { error: "App metrics helper unavailable" },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    // Serve the HTML page (fresh on every request — picks up state + rebuild)
    return new Response(await buildHtml(dependencies, readStates, selectedDevice), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  };
}

export async function startDevServer(
  dependencies: DevServerDependencies = {
    hostCommands: createNodeHostCommands(),
    stateDir: STATE_DIR,
    serveSimBin: SERVE_SIM_BIN,
    resolveDeviceMetadata: resolveInstalledDeviceMetadata,
  },
) {
  await Promise.all([buildClient(), buildTailwindCss()]);
  lastTailwindContentSignature = readTailwindContentSignature();
  watch(CLIENT_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = String(filename);
    if (!/\.(tsx?|css)$/.test(name)) return;
    if (/\.tsx?$/.test(name)) pendingClientBuild = true;
    if (/\.css$/.test(name)) pendingTailwindBuild = true;
    scheduleWatchedBuild();
  });

  const server = Bun.serve({
    port: PORT,
    idleTimeout: 255,
    fetch: createDevFetchHandler(dependencies),
  });
  console.log(`\n  \x1b[36mheadless-serve-sim dev\x1b[0m  http://localhost:${PORT}\n`);
  return server;
}

if (import.meta.main) await startDevServer();
