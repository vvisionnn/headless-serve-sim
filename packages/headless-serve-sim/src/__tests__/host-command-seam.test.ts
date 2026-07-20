import { describe, expect, test } from "bun:test";
import {
  findHostCommandSeamViolations,
  formatHostCommandSeamViolations,
  scanHostCommandSeam,
  type SourceInput,
} from "../../../../scripts/check-host-command-seam";

const ROOT = "packages/headless-serve-sim/src/";

function scan(path: string, source: string) {
  return findHostCommandSeamViolations([{ path: `${ROOT}${path}`, source }]);
}

describe("host-command Seam scanner", () => {
  test("allows all host primitives inside the Node adapter", () => {
    expect(
      scan(
        "runtime/node-host-commands.ts",
        `
      import { spawn } from "node:child_process";
      Bun.spawn(["tool"]);
      process.kill(42, "SIGTERM");
    `,
      ),
    ).toEqual([]);
  });

  test("rejects direct process imports, Bun spawning, and process signals", () => {
    const violations = scan(
      "feature.ts",
      `
      import { spawn } from "child_process";
      Bun.spawn(["tool"]);
      Bun["spawnSync"](["tool"]);
      process.kill(42, "SIGTERM");
    `,
    );
    expect(violations.map((violation) => violation.rule)).toEqual([
      "child-process-import",
      "direct-bun-spawn",
      "direct-bun-spawn",
      "direct-process-kill",
    ]);
  });

  test("recognizes re-exports, require, and dynamic imports", () => {
    const inputs: SourceInput[] = [
      { path: `${ROOT}one.ts`, source: `export { spawn } from "node:child_process";` },
      { path: `${ROOT}two.ts`, source: `const child = require("child_process");` },
      { path: `${ROOT}three.ts`, source: `await import("node:child_process");` },
    ];
    expect(findHostCommandSeamViolations(inputs).map((violation) => violation.rule)).toEqual([
      "child-process-import",
      "child-process-import",
      "child-process-import",
    ]);
  });

  test("ignores harmless mentions in comments and strings", () => {
    expect(
      scan(
        "notes.ts",
        `
      // import { spawn } from "child_process";
      const documentation = "Bun.spawn and process.kill are forbidden";
    `,
      ),
    ).toEqual([]);
  });

  test("excludes explicit system tests and files outside runtime source", () => {
    expect(
      findHostCommandSeamViolations([
        {
          path: `${ROOT}system-tests/native.system.ts`,
          source: `import { spawn } from "child_process"; process.kill(1);`,
        },
        {
          path: "packages/headless-serve-sim/build.ts",
          source: `import { spawn } from "child_process"; Bun.spawn(["tool"]);`,
        },
      ]),
    ).toEqual([]);
  });

  test("ordinary tests require explicit fake Node adapter overrides", () => {
    expect(
      scan(
        "__tests__/unsafe.test.ts",
        `
      createNodeHostCommands();
      createNodeHostCommands({});
      createNodeHostCommands({ spawn: fakeSpawn });
    `,
      ).map((violation) => violation.rule),
    ).toEqual(["real-adapter-in-test", "real-adapter-in-test"]);
    expect(
      scan(
        "__tests__/host-commands.test.ts",
        `
      createNodeHostCommands();
    `,
      ),
    ).toEqual([]);
  });

  test("ordinary tests may launch guarded local fixtures", () => {
    expect(
      scan(
        "__tests__/local-fixture.test.ts",
        `import { spawn } from "child_process"; spawn("bun", ["fixture.ts"]);`,
      ),
    ).toEqual([]);
  });
});

test("workspace runtime source crosses host tooling only through the Node adapter", () => {
  const violations = scanHostCommandSeam();
  expect(formatHostCommandSeamViolations(violations)).toBe("");
});
