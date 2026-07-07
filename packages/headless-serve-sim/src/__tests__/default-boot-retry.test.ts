import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeFakeXcrun(): { binDir: string; logPath: string; tmpRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), "hss-default-boot-retry-"));
  createdDirs.push(dir);
  const binDir = join(dir, "bin");
  const tmpRoot = join(dir, "tmp");
  const logPath = join(dir, "xcrun.log");
  const xcrunPath = join(binDir, "xcrun");
  mkdirSync(binDir);
  mkdirSync(tmpRoot);
  writeFileSync(
    xcrunPath,
    `#!/bin/sh
mkdir -p "$(dirname "$HEADLESS_SERVE_SIM_XCRUN_LOG")"
printf '%s\\n' "$*" >> "$HEADLESS_SERVE_SIM_XCRUN_LOG"

if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "booted" ]; then
  if [ -n "$HEADLESS_SERVE_SIM_EXISTING_UDID" ]; then
    printf '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-2":[{"udid":"%s","state":"Booted"}]}}\\n' "$HEADLESS_SERVE_SIM_EXISTING_UDID"
  else
    printf '{"devices":{}}\\n'
  fi
  exit 0
fi

if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-2":[{"udid":"BAD","name":"iPhone 17 Pro","state":"Shutdown"}],"com.apple.CoreSimulator.SimRuntime.iOS-26-1":[{"udid":"FALLBACK","name":"iPhone 15 Pro","state":"Shutdown"}]}}
JSON
  exit 0
fi

if [ "$1" = "simctl" ] && [ "$2" = "boot" ]; then
  exit 0
fi

if [ "$1" = "simctl" ] && [ "$2" = "bootstatus" ]; then
  echo "bootstatus failed for $3" >&2
  exit 1
fi

if [ "$1" = "simctl" ] && [ "$2" = "shutdown" ]; then
  exit 0
fi

echo "unexpected xcrun args: $*" >&2
exit 1
`,
  );
  chmodSync(xcrunPath, 0o755);
  return { binDir, logPath, tmpRoot };
}

function writeManagedState(tmpRoot: string, udid: string): void {
  const stateDir = join(tmpRoot, "headless-serve-sim");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, `server-${udid}.json`),
    JSON.stringify({
      pid: process.pid,
      port: 3555,
      device: udid,
      url: "http://127.0.0.1:3555",
      streamUrl: "http://127.0.0.1:3555/stream.mjpeg",
      wsUrl: "ws://127.0.0.1:3555",
      headed: false,
    }),
  );
}

describe("default simulator boot retry", () => {
  test("tries the next shutdown default when bootstatus fails", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..");
    const indexPath = join(repoRoot, "packages/headless-serve-sim/src/index.ts");
    const { binDir, logPath, tmpRoot } = makeFakeXcrun();

    const result = spawnSync(process.execPath, [indexPath, "--detach"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HEADLESS_SERVE_SIM_XCRUN_LOG: logPath,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TMPDIR: tmpRoot,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Skipping iPhone 17 Pro");
    expect(result.stderr).toContain("Skipping iPhone 15 Pro");
    expect(result.stderr).toContain("No shutdown iPhone simulator could be booted");

    const calls = readFileSync(logPath, "utf-8");
    expect(calls).toContain("simctl boot BAD");
    expect(calls).toContain("simctl shutdown BAD");
    expect(calls).toContain("simctl boot FALLBACK");
  });

  test("detach returns an existing managed stream before selecting shutdown defaults", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..");
    const indexPath = join(repoRoot, "packages/headless-serve-sim/src/index.ts");
    const { binDir, logPath, tmpRoot } = makeFakeXcrun();
    writeManagedState(tmpRoot, "EXISTING");

    const result = spawnSync(process.execPath, [indexPath, "--detach"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HEADLESS_SERVE_SIM_EXISTING_UDID: "EXISTING",
        HEADLESS_SERVE_SIM_XCRUN_LOG: logPath,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TMPDIR: tmpRoot,
      },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ device: "EXISTING", port: 3555 });

    const calls = readFileSync(logPath, "utf-8");
    expect(calls).toContain("simctl list devices booted -j");
    expect(calls).not.toContain("simctl boot BAD");
    expect(calls).not.toContain("simctl boot FALLBACK");
  });

  test("no-preview returns an existing managed stream before selecting shutdown defaults", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..");
    const indexPath = join(repoRoot, "packages/headless-serve-sim/src/index.ts");
    const { binDir, logPath, tmpRoot } = makeFakeXcrun();
    writeManagedState(tmpRoot, "EXISTING");

    const result = spawnSync(process.execPath, [indexPath, "--no-preview", "--quiet"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HEADLESS_SERVE_SIM_EXISTING_UDID: "EXISTING",
        HEADLESS_SERVE_SIM_XCRUN_LOG: logPath,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TMPDIR: tmpRoot,
      },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ device: "EXISTING", port: 3555 });

    const calls = readFileSync(logPath, "utf-8");
    expect(calls).toContain("simctl list devices booted -j");
    expect(calls).not.toContain("simctl boot BAD");
    expect(calls).not.toContain("simctl boot FALLBACK");
  });
});
