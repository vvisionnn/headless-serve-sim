import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// End-to-end proof, using *isolated* throwaway simulators, that /api device
// resolution (the seam the pinned /api/events SSE uses) never re-targets a
// different booted simulator:
//
//   • GET /api?device=A           -> A's config   (pinned; auto-connect OFF)
//   • GET /api?device=A (A gone)  -> null          (waits for A; never B)
//   • GET /api           (A gone) -> B's config    (legacy fallback; auto-connect ON)
//
// This machine may have real headless-serve-sim helpers live in the shared state
// dir, and readServeSimStates() SIGTERMs the pid of any state whose device isn't
// booted. So the middleware is run in a CHILD bun process whose TMPDIR points at
// an isolated temp dir — it can only ever see the two synthetic state files this
// test writes there, and the parent test process never imports the middleware
// (no shared module cache, no env mutation, no risk to the real state dir).

const ISOLATED_TMP = mkdtempSync(join(tmpdir(), "auto-connect-e2e-"));
const STATE_DIR = join(ISOLATED_TMP, "headless-serve-sim");
const TOKEN = "auto-connect-e2e-token";
const MIDDLEWARE = join(import.meta.dir, "..", "middleware.ts");

function xcrun(args: string[]): string {
  return execFileSync("xcrun", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function simctlUsable(): boolean {
  try {
    xcrun(["simctl", "help"]);
    return true;
  } catch {
    return false;
  }
}

function bootedUdids(): Set<string> {
  const data = JSON.parse(xcrun(["simctl", "list", "devices", "booted", "-j"])) as {
    devices: Record<string, { udid: string; state: string }[]>;
  };
  const set = new Set<string>();
  for (const list of Object.values(data.devices)) {
    for (const d of list) if (d.state === "Booted") set.add(d.udid);
  }
  return set;
}

function pickRuntimeAndType(): { runtime: string; type: string } {
  const data = JSON.parse(xcrun(["simctl", "list", "runtimes", "-j"])) as {
    runtimes: {
      identifier: string;
      name: string;
      isAvailable?: boolean;
      supportedDeviceTypes?: { identifier: string; name: string }[];
    }[];
  };
  // Newest iOS runtime that still advertises a compatible iPhone device type.
  const ios = data.runtimes.filter((r) => r.isAvailable !== false && /iOS/.test(r.name));
  for (let i = ios.length - 1; i >= 0; i--) {
    const iphones = (ios[i]!.supportedDeviceTypes ?? []).filter((d) => /iPhone/.test(d.name));
    const type = iphones[iphones.length - 1];
    if (type) return { runtime: ios[i]!.identifier, type: type.identifier };
  }
  throw new Error("no compatible iOS runtime + iPhone device type pair available");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitBooted(udid: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bootedUdids().has(udid)) return;
    await sleep(500);
  }
  throw new Error(`simulator ${udid} never reached Booted`);
}

// Tiny middleware server whose STATE_DIR is isolated by the child's TMPDIR env.
const CHILD_SRC = `
const { createServer } = require("http");
(async () => {
  const { simMiddleware } = await import(process.env.MW);
  const handler = simMiddleware({ basePath: "/", execToken: process.env.TOKEN });
  const server = createServer((req, res) =>
    handler(req, res, () => { if (!res.headersSent) res.statusCode = 404; res.end("Not found"); }));
  server.listen(0, "127.0.0.1", () => console.log("PORT " + server.address().port));
})();
`;

const describeIfSim = simctlUsable() ? describe : describe.skip;

describeIfSim("auto-connect /api pin (isolated simulators)", () => {
  const created: string[] = [];
  const keepalive: ChildProcess[] = [];
  let child: ChildProcess | undefined;
  let origin = "";
  let udidA = "";
  let udidB = "";

  // Synthetic helper state backed by a harmless live process, so the child's
  // readServeSimStates() liveness probe passes and its recycle path (SIGTERM on
  // shutdown) only ever hits our own `sleep`.
  function writeState(udid: string, port: number): void {
    const proc = spawn("sleep", ["600"], { stdio: "ignore" });
    keepalive.push(proc);
    writeFileSync(
      join(STATE_DIR, `server-${udid}.json`),
      JSON.stringify({
        pid: proc.pid,
        port,
        device: udid,
        url: `http://127.0.0.1:${port}`,
        streamUrl: `http://127.0.0.1:${port}/stream.mjpeg`,
        wsUrl: `ws://127.0.0.1:${port}/ws`,
      }),
    );
  }

  async function apiConfig(device?: string): Promise<{ device: string } | null> {
    const qs = device ? `?device=${encodeURIComponent(device)}` : "";
    const res = await fetch(`${origin}/api${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { device: string } | null;
  }

  beforeAll(async () => {
    mkdirSync(STATE_DIR, { recursive: true });
    const { runtime, type } = pickRuntimeAndType();
    udidA = xcrun(["simctl", "create", "auto-connect-e2e-A", type, runtime]).trim();
    created.push(udidA);
    udidB = xcrun(["simctl", "create", "auto-connect-e2e-B", type, runtime]).trim();
    created.push(udidB);
    xcrun(["simctl", "boot", udidA]);
    xcrun(["simctl", "boot", udidB]);
    await waitBooted(udidA);
    await waitBooted(udidB);

    writeState(udidA, 59321);
    writeState(udidB, 59322);

    child = spawn("bun", ["-e", CHILD_SRC], {
      env: { ...process.env, TMPDIR: ISOLATED_TMP, TOKEN, MW: MIDDLEWARE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    origin = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("middleware child never reported a port")), 20_000);
      child!.stdout!.on("data", (d) => {
        buf += String(d);
        const m = buf.match(/PORT (\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${m[1]}`);
        }
      });
      child!.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`middleware child exited early (code ${code})`));
      });
    });
  }, 300_000);

  afterAll(async () => {
    child?.kill("SIGKILL");
    for (const c of keepalive) {
      try {
        c.kill("SIGKILL");
      } catch {}
    }
    for (const u of created) {
      try {
        xcrun(["simctl", "shutdown", u]);
      } catch {}
      try {
        xcrun(["simctl", "delete", u]);
      } catch {}
    }
    try {
      rmSync(ISOLATED_TMP, { recursive: true, force: true });
    } catch {}
  }, 120_000);

  test("a pinned request resolves to exactly that simulator", async () => {
    expect((await apiConfig(udidA))?.device).toBe(udidA);
    expect((await apiConfig(udidB))?.device).toBe(udidB);
  });

  test("after the pinned simulator shuts down it returns null — never the other booted one", async () => {
    xcrun(["simctl", "shutdown", udidA]);

    // getBootedUdids() caches ~1.5s and shutdown isn't instant; poll the seam.
    let pinned: { device: string } | null = { device: udidA };
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      pinned = await apiConfig(udidA);
      if (pinned === null) break;
      await sleep(500);
    }

    // The core guarantee: pinned-to-A never hops to B.
    expect(pinned).toBeNull();

    // Contrast: an UNPINNED request (legacy auto-connect ON) does fall back to
    // the surviving booted simulator — exactly what pinning suppresses.
    expect((await apiConfig())?.device).toBe(udidB);
  }, 60_000);
});
