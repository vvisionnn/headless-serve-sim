import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Native e2e for `headless-serve-sim type`.
 *
 * Boots through the full stack: textToKeyEvents → WS 0x06 frames →
 * SimStreamHelper.ClientManager → HIDInjector.sendKey → CoreSimulator's HID
 * legacy client. The helper logs `[hid] Key <down|up> usage=0x<hex>` for every
 * accepted key event, which is what we assert against — proving the event
 * round-tripped all the way to the sim, not just to the helper's WS reader.
 *
 * Requires an explicitly leased simulator from the system-test harness.
 */

const CLI_PATH = join(import.meta.dir, "../../src/index.ts");
const STATE_DIR = join(tmpdir(), "headless-serve-sim");

const bootedUdid = process.env.HEADLESS_SERVE_SIM_SYSTEM_TEST_UDID;
const describeWithSim =
  process.env.HEADLESS_SERVE_SIM_SYSTEM_TESTS === "1" && bootedUdid ? describe : describe.skip;

describeWithSim(`headless-serve-sim type e2e (booted sim ${bootedUdid ?? "<skipped>"})`, () => {
  let logFile: string;

  beforeAll(() => {
    try {
      execFileSync("bun", ["run", CLI_PATH, "--kill", bootedUdid!], { stdio: "pipe" });
    } catch {}

    const detach = spawnSync("bun", ["run", CLI_PATH, "--detach", bootedUdid!], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
      timeout: 90_000,
    });
    if (detach.status !== 0 || !detach.stdout) {
      throw new Error(
        `headless-serve-sim --detach failed (exit=${detach.status} signal=${detach.signal})\nstdout: ${detach.stdout}`,
      );
    }
    logFile = join(STATE_DIR, `server-${bootedUdid!}.log`);
  }, 120_000);

  afterAll(() => {
    try {
      execFileSync("bun", ["run", CLI_PATH, "--kill", bootedUdid!], { stdio: "pipe" });
    } catch {}
  });

  test("`headless-serve-sim type` injects HID key events into the booted simulator", async () => {
    const logBefore = readFileSync(logFile, "utf-8");
    const beforeCount = countKeyLines(logBefore);

    // "Hi!" → 10 events:
    //   H: shift down, KeyH down, KeyH up, shift up      (0xe1, 0x0b, 0x0b, 0xe1)
    //   i: KeyI down, KeyI up                            (0x0c, 0x0c)
    //   !: shift down, Digit1 down, Digit1 up, shift up  (0xe1, 0x1e, 0x1e, 0xe1)
    const result = spawnSync("bun", ["run", CLI_PATH, "type", "Hi!", "-d", bootedUdid!], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    expect(result.status).toBe(0);

    // The 10 `[hid] Key …` lines are emitted by the *detached helper* process
    // (stdout redirected to logFile), not by the `type` child we just awaited.
    // On a loaded runner they can take well over 200ms to be received over the
    // WS and flushed, so poll until the expected count lands rather than sleeping
    // a fixed amount. Assertion (exactly 10) is unchanged.
    const deadline = Date.now() + 10_000;
    let logAfter = readFileSync(logFile, "utf-8");
    while (countKeyLines(logAfter) - beforeCount < 10 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      logAfter = readFileSync(logFile, "utf-8");
    }
    const newLines = logAfter.slice(logBefore.length);
    const afterCount = countKeyLines(logAfter);

    expect(afterCount - beforeCount).toBe(10);

    // Every usage we sent must show up at least once in the new log slice.
    const expectedUsages = [0xe1, 0x0b, 0x0c, 0x1e];
    for (const usage of expectedUsages) {
      const hex = usage.toString(16);
      expect(newLines).toContain(`usage=0x${hex}`);
    }

    // And we should see balanced down/up events for the new slice.
    expect(countMatches(newLines, /\[hid\] Key down /g)).toBe(5);
    expect(countMatches(newLines, /\[hid\] Key up /g)).toBe(5);
  }, 60_000);
});

function countKeyLines(s: string): number {
  return countMatches(s, /\[hid\] Key (down|up) /g);
}

function countMatches(s: string, re: RegExp): number {
  let n = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) n++;
  return n;
}
