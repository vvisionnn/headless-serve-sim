import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";

const INDEX = join(import.meta.dir, "..", "index.ts");
const DIST_INDEX = join(import.meta.dir, "..", "..", "dist", "headless-serve-sim.js");
const children: ChildProcess[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a test port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

describe("preview startup", () => {
  async function expectPassiveStartup(entry: string): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "preview-startup-"));
    tempDirs.push(dir);
    const binDir = join(dir, "bin");
    const marker = join(dir, "xcrun-invoked");
    const fakeXcrun = join(binDir, "xcrun");
    mkdirSync(binDir);
    writeFileSync(fakeXcrun, `#!/bin/sh\ntouch "${marker}"\nexit 99\n`);
    chmodSync(fakeXcrun, 0o755);

    const port = await freePort();
    const child = spawn(process.execPath, [entry, "--port", String(port)], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TMPDIR: dir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

    let output = "";
    child.stdout!.on("data", (chunk) => { output += String(chunk); });
    child.stderr!.on("data", (chunk) => { output += String(chunk); });

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`preview did not start:\n${output}`)), 5_000);
      const check = () => {
        if (output.includes("- Local:")) {
          clearTimeout(deadline);
          resolve();
        } else if (child.exitCode !== null) {
          clearTimeout(deadline);
          reject(new Error(`preview exited before listening:\n${output}`));
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });

    expect(existsSync(marker)).toBe(false);
  }

  test("source starts unselected without invoking simulator tooling", async () => {
    await expectPassiveStartup(INDEX);
  }, 10_000);

  test("built CLI starts unselected without invoking simulator tooling", async () => {
    await expectPassiveStartup(DIST_INDEX);
  }, 10_000);

  async function expectExplicitDeviceRequired(entry: string, args: string[]): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "explicit-device-required-"));
    tempDirs.push(dir);
    const binDir = join(dir, "bin");
    const marker = join(dir, "xcrun-invoked");
    const fakeXcrun = join(binDir, "xcrun");
    mkdirSync(binDir);
    writeFileSync(fakeXcrun, `#!/bin/sh\ntouch "${marker}"\nexit 99\n`);
    chmodSync(fakeXcrun, 0o755);

    const child = spawn(process.execPath, [entry, ...args], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TMPDIR: dir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout!.on("data", (chunk) => { output += String(chunk); });
    child.stderr!.on("data", (chunk) => { output += String(chunk); });
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));

    expect(exitCode).toBe(1);
    expect(output).toContain("Select a simulator explicitly");
    expect(existsSync(marker)).toBe(false);
  }

  test("detached streaming requires an explicit device", async () => {
    await expectExplicitDeviceRequired(INDEX, ["--detach"]);
  });

  test("foreground streaming requires an explicit device", async () => {
    await expectExplicitDeviceRequired(INDEX, ["--no-preview"]);
  });

  test("built detached streaming requires an explicit device", async () => {
    await expectExplicitDeviceRequired(DIST_INDEX, ["--detach"]);
  });

  test("built foreground streaming requires an explicit device", async () => {
    await expectExplicitDeviceRequired(DIST_INDEX, ["--no-preview"]);
  });
});
