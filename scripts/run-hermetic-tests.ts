import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";

const blockedPrograms = [
  "xcrun",
  "simctl",
  "defaults",
  "osascript",
  "xcode-select",
  "open",
] as const;

const guardDirectory = mkdtempSync(join(tmpdir(), "headless-serve-sim-test-guard-"));
const testTempDirectory = join(guardDirectory, "tmp");
const guardScript = `#!/bin/sh
printf 'Hermetic test attempted blocked host command: %s' "$0" >&2
for arg in "$@"; do printf ' %s' "$arg" >&2; done
printf '\n' >&2
exit 126
`;

try {
  // State and camera helpers also use os.tmpdir(); command denial alone does
  // not prevent a test fixture from reading or deleting a real session's files.
  mkdirSync(testTempDirectory);
  for (const program of blockedPrograms) {
    const path = join(guardDirectory, program);
    writeFileSync(path, guardScript);
    chmodSync(path, 0o755);
  }

  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    targets.push(
      "packages/headless-serve-sim-client/src/__tests__",
      "packages/headless-serve-sim/src/__tests__",
    );
  }

  const result = Bun.spawnSync([process.execPath, "test", ...targets], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HEADLESS_SERVE_SIM_HOST_COMMANDS: "deny",
      TMPDIR: testTempDirectory,
      TMP: testTempDirectory,
      TEMP: testTempDirectory,
      PATH: `${guardDirectory}${delimiter}${process.env.PATH ?? ""}`,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  process.exitCode = result.exitCode;
} finally {
  rmSync(guardDirectory, { recursive: true, force: true });
}
