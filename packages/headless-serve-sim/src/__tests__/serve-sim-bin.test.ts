import { describe, expect, test } from "bun:test";
import { resolveServeSimInvocation, serveSimBinFor } from "../middleware";

// Resolver helpers for the pure function under test.
const allExist = () => true;
const realFsOnly = (p: string) => !p.startsWith("/$bunfs/"); // bunfs paths aren't on the real FS
const noPath = () => null;
const foundOnPath = (p: string) => () => p;

describe("resolveServeSimInvocation", () => {
  test("compiled binary: /$bunfs/ argv[1] resolves to execPath (bare command)", () => {
    // The reported bug: argv[1] is the virtual /$bunfs/ entry (named after our
    // build outfile), argv[0] is the literal "bun"; execPath is the real binary.
    const inv = resolveServeSimInvocation(
      ["bun", "/$bunfs/root/headless-serve-sim", "serve"],
      "/opt/homebrew/bin/headless-serve-sim",
      realFsOnly,
      noPath,
    );
    expect(inv).toEqual({ command: "/opt/homebrew/bin/headless-serve-sim", baseArgs: [] });
  });

  test("compiled binary renamed on disk: bunfs entry still names us → execPath", () => {
    // `mv headless-serve-sim mysim` keeps the build-time bunfs entry name, so we
    // still recognise ourselves and run the (renamed) on-disk binary.
    const inv = resolveServeSimInvocation(
      ["bun", "/$bunfs/root/headless-serve-sim"],
      "/usr/local/bin/mysim",
      realFsOnly,
      noPath,
    );
    expect(inv).toEqual({ command: "/usr/local/bin/mysim", baseArgs: [] });
  });

  test("foreign bun-compiled host embedding our middleware → PATH, NOT the host binary", () => {
    // argv[1] is the HOST's /$bunfs/ entry and execPath is the HOST binary
    // (which exists). We must not run the host as our CLI — fall back to PATH.
    const inv = resolveServeSimInvocation(
      ["bun", "/$bunfs/root/their-app", "start"],
      "/usr/local/bin/their-app", // a REAL host binary (exists)
      allExist,
      foundOnPath("/usr/local/bin/headless-serve-sim"),
    );
    expect(inv).toEqual({ command: "/usr/local/bin/headless-serve-sim", baseArgs: [] });
  });

  test("foreign bun-compiled host with nothing on PATH → null", () => {
    const inv = resolveServeSimInvocation(
      ["bun", "/$bunfs/root/their-app", "start"],
      "/usr/local/bin/their-app",
      allExist,
      noPath,
    );
    expect(inv).toBeNull();
  });

  test("argv[0] is the compiled binary directly (no bunfs entry)", () => {
    const inv = resolveServeSimInvocation(
      ["/usr/local/bin/headless-serve-sim", "serve", "-p", "3399"],
      "/usr/local/bin/headless-serve-sim",
      allExist,
      noPath,
    );
    expect(inv).toEqual({ command: "/usr/local/bin/headless-serve-sim", baseArgs: [] });
  });

  test("node dist/headless-serve-sim.js → node + entry (npm install / npx)", () => {
    const inv = resolveServeSimInvocation(
      ["/usr/bin/node", "/app/node_modules/headless-serve-sim/dist/headless-serve-sim.js", "serve"],
      "/usr/bin/node",
      allExist,
      noPath,
    );
    expect(inv).toEqual({
      command: "/usr/bin/node",
      baseArgs: ["/app/node_modules/headless-serve-sim/dist/headless-serve-sim.js"],
    });
  });

  test("node_modules/.bin link (executable, no .js extension) → node + link", () => {
    // Launching `./node_modules/.bin/headless-serve-sim` puts the link path
    // (basename headless-serve-sim, no .js) in argv[1]; it must still resolve.
    const inv = resolveServeSimInvocation(
      ["/usr/bin/node", "/app/node_modules/.bin/headless-serve-sim", "serve"],
      "/usr/bin/node",
      allExist,
      noPath, // .bin not on PATH — the old PATH fallback would have failed here
    );
    expect(inv).toEqual({
      command: "/usr/bin/node",
      baseArgs: ["/app/node_modules/.bin/headless-serve-sim"],
    });
  });

  test("embedded in a node host dev server (Metro/Expo) → PATH fallback, never the host entry", () => {
    const inv = resolveServeSimInvocation(
      ["/usr/bin/node", "/app/node_modules/.bin/expo", "start"],
      "/usr/bin/node",
      allExist,
      foundOnPath("/usr/local/bin/headless-serve-sim"),
    );
    expect(inv).toEqual({ command: "/usr/local/bin/headless-serve-sim", baseArgs: [] });
  });

  test("embedded node host with nothing on PATH → null (caller uses bare name)", () => {
    const inv = resolveServeSimInvocation(
      ["/usr/bin/node", "/app/node_modules/.bin/expo", "start"],
      "/usr/bin/node",
      allExist,
      noPath,
    );
    expect(inv).toBeNull();
  });
});

describe("serveSimBinFor", () => {
  test("null → bare PATH name", () => {
    expect(serveSimBinFor(null)).toBe("headless-serve-sim");
  });

  test("bare command (compiled binary / PATH) → command itself", () => {
    expect(serveSimBinFor({ command: "/opt/homebrew/bin/headless-serve-sim", baseArgs: [] })).toBe(
      "/opt/homebrew/bin/headless-serve-sim",
    );
  });

  test("node + .js entry → the entry path (browser re-derives node from the .js)", () => {
    expect(
      serveSimBinFor({ command: "/usr/bin/node", baseArgs: ["/app/dist/headless-serve-sim.js"] }),
    ).toBe("/app/dist/headless-serve-sim.js");
  });

  test("node + .bin link entry → the link path (browser runs it bare via shebang)", () => {
    expect(
      serveSimBinFor({
        command: "/usr/bin/node",
        baseArgs: ["/app/node_modules/.bin/headless-serve-sim"],
      }),
    ).toBe("/app/node_modules/.bin/headless-serve-sim");
  });
});

describe("regression guard: browser never receives an unexecutable /$bunfs/ path", () => {
  test("compiled binary end-to-end (resolve → browser string)", () => {
    const bin = serveSimBinFor(
      resolveServeSimInvocation(
        ["bun", "/$bunfs/root/headless-serve-sim", "serve"],
        "/opt/homebrew/bin/headless-serve-sim",
        realFsOnly,
        noPath,
      ),
    );
    expect(bin.startsWith("/$bunfs/")).toBe(false);
    expect(bin).toBe("/opt/homebrew/bin/headless-serve-sim");
  });
});
