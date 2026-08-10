import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "net";
import {
  cameraStatus,
  helperSocketFile,
  isHelperAlive,
  readInjectedBundles,
  type SignalProbe,
} from "../camera-helper";

/** A signal seam whose answers are scripted, never touching a real process. */
function probe(alive: Record<number, boolean>): SignalProbe {
  return { signal: (pid: number) => alive[pid] ?? false };
}

const DEAD: SignalProbe = probe({});

describe("helperSocketFile", () => {
  test("stays inside the macOS sun_path limit", () => {
    // sun_path is 104 bytes; a path over it fails to bind with a confusing
    // ENAMETOOLONG rather than anything mentioning length.
    const path = helperSocketFile("11111111-2222-3333-4444-555555555555");
    expect(path.length).toBeLessThan(104);
  });

  test("is stable for a udid and distinct across udids", () => {
    const a = helperSocketFile("UDID-A");
    expect(helperSocketFile("UDID-A")).toBe(a);
    expect(helperSocketFile("UDID-B")).not.toBe(a);
  });
});

describe("isHelperAlive", () => {
  test("false when no pid file exists", () => {
    expect(isHelperAlive("no-such-device-udid", DEAD)).toBe(false);
  });

  test("false when the recorded pid is gone", () => {
    // The common case after a crash: the pid file outlives the process.
    expect(isHelperAlive("also-missing-udid", probe({ 999999: false }))).toBe(false);
  });
});

describe("readInjectedBundles", () => {
  test("empty when nothing was recorded", () => {
    expect(readInjectedBundles("device-with-no-bundles")).toEqual([]);
  });
});

describe("cameraStatus", () => {
  test("reports not-alive without a helper, and never throws", async () => {
    await expect(cameraStatus("missing-device-udid", DEAD)).resolves.toEqual({
      udid: "missing-device-udid",
      alive: false,
    });
  });
});

describe("cameraStatus against a stub helper socket", () => {
  // Exercises the real socket protocol: connect, write one JSON line, read one
  // JSON line back. This is what replaced a CLI subprocess per poll tick.
  test("returns the helper's reply merged with local state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "camera-helper-test-"));
    const udid = `stub-${process.pid}`;
    const socketPath = helperSocketFile(udid);
    const server = createServer((conn) => {
      conn.on("data", () => {
        conn.write(JSON.stringify({ ok: true, source: "webcam", mirror: "on" }) + "\n");
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));

      // Point the module's state dir entries at a live pid we control.
      const stateDir = join(tmpdir(), "headless-serve-sim", "simcam");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, `${udid}.pid`), String(process.pid));

      const status = await cameraStatus(udid, probe({ [process.pid]: true }));
      expect(status.alive).toBe(true);
      expect(status.source).toBe("webcam");
      expect(status.mirror).toBe("on");
      expect(status.helperPid).toBe(process.pid);
    } finally {
      server.close();
      rmSync(socketPath, { force: true });
      rmSync(join(tmpdir(), "headless-serve-sim", "simcam", `${udid}.pid`), { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("still reports alive when the helper accepts but never replies", async () => {
    // pid + socket present but silent. Reporting dead here would make the UI
    // offer a pointless "inject + relaunch" for a helper that is running.
    const udid = `silent-${process.pid}`;
    const socketPath = helperSocketFile(udid);
    const server = createServer(() => {
      /* accept and say nothing */
    });
    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      const stateDir = join(tmpdir(), "headless-serve-sim", "simcam");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, `${udid}.pid`), String(process.pid));

      const status = await cameraStatus(udid, probe({ [process.pid]: true }));
      expect(status.alive).toBe(true);
      expect(status.error).toBeTruthy();
    } finally {
      server.close();
      rmSync(socketPath, { force: true });
      rmSync(join(tmpdir(), "headless-serve-sim", "simcam", `${udid}.pid`), { force: true });
    }
  }, 10_000);
});
