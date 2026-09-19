import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("hermetic runner isolates and cleans temporary simulator state", () => {
  const directory = mkdtempSync(join(tmpdir(), "hermetic-runner-test-"));
  const fixture = join(directory, "isolated.test.ts");
  const receipt = join(directory, "temp-path.txt");
  writeFileSync(
    fixture,
    `
    import { expect, test } from "bun:test";
    import { tmpdir } from "node:os";
    import { mkdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    test("isolated state", () => {
      expect(tmpdir()).not.toBe(process.env.SERVE_SIM_TEST_PARENT_TMPDIR);
      const state = join(tmpdir(), "headless-serve-sim");
      mkdirSync(state);
      writeFileSync(join(state, "server-TEST.json"), "{}");
      writeFileSync(process.env.SERVE_SIM_TEST_RECEIPT, tmpdir());
    });
  `,
  );
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        resolve(import.meta.dir, "../../../../scripts/run-hermetic-tests.ts"),
        fixture,
      ],
      {
        env: {
          ...process.env,
          SERVE_SIM_TEST_PARENT_TMPDIR: tmpdir(),
          SERVE_SIM_TEST_RECEIPT: receipt,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(readFileSync(receipt, "utf8"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
