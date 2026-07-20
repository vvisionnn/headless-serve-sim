import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const dangerousProgram = "(?:xcrun|simctl|defaults|osascript|xcode-select|open)";
const directProcessCall = new RegExp(
  String.raw`\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*["'\x60]${dangerousProgram}\b`,
);
const directBunCall = new RegExp(
  String.raw`\bBun\.spawn(?:Sync)?\s*\(\s*\[\s*["'\x60]${dangerousProgram}\b`,
);
const ambientSimulatorSelection =
  /\b(?:firstBooted(?:IosSim)?|bootedUdid)\s*\(|HEADLESS_SERVE_SIM_E2E_UDID/;

export function unsafeTestReason(source: string): string | null {
  if (directProcessCall.test(source) || directBunCall.test(source)) {
    return "executes a simulator/Xcode host program directly";
  }
  if (ambientSimulatorSelection.test(source)) {
    return "discovers or falls back to an ambient booted simulator";
  }
  return null;
}

function testFiles(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...testFiles(path));
    else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

export function findUnsafeTests(root: string): string[] {
  const violations: string[] = [];
  for (const directory of [
    join(root, "packages", "headless-serve-sim", "src", "__tests__"),
    join(root, "packages", "headless-serve-sim-client", "src", "__tests__"),
  ]) {
    for (const file of testFiles(directory)) {
      const reason = unsafeTestReason(readFileSync(file, "utf8"));
      if (reason) violations.push(`${file}: ${reason}`);
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = findUnsafeTests(process.cwd());
  if (violations.length > 0) {
    console.error("Unsafe ordinary tests found:\n" + violations.join("\n"));
    process.exitCode = 1;
  }
}
