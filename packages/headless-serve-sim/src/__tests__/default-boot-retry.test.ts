import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const createdDirs: string[] = [];
const repoRoot = resolve(import.meta.dir, "../../../..");
const indexPath = join(repoRoot, "packages/headless-serve-sim/src/index.ts");

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hss-explicit-selection-"));
  createdDirs.push(root);
  return root;
}

function writeManagedState(tmpRoot: string): void {
  const stateDir = join(tmpRoot, "headless-serve-sim");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "server-EXISTING.json"),
    JSON.stringify({
      pid: process.pid,
      port: 3555,
      device: "EXISTING",
      url: "http://127.0.0.1:3555",
      streamUrl: "http://127.0.0.1:3555/stream.mjpeg",
      wsUrl: "ws://127.0.0.1:3555",
      headed: false,
    }),
  );
}

function runCli(args: string[], tmpRoot: string) {
  return spawnSync(process.execPath, [indexPath, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      HEADLESS_SERVE_SIM_HOST_COMMANDS: "deny",
      TMPDIR: tmpRoot,
    },
  });
}

describe("explicit simulator selection", () => {
  test("detach and foreground streaming reject an omitted device", () => {
    for (const args of [["--detach"], ["--no-preview", "--quiet"]]) {
      const result = runCli(args, temporaryRoot());

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Select a simulator explicitly");
      expect(result.stderr).not.toContain("Host command execution is disabled");
    }
  });

  test("an ambient managed stream does not bypass explicit selection", () => {
    for (const args of [["--detach"], ["--no-preview", "--quiet"]]) {
      const tmpRoot = temporaryRoot();
      writeManagedState(tmpRoot);

      const result = runCli(args, tmpRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Select a simulator explicitly");
      expect(result.stdout).toBe("");
    }
  });
});
