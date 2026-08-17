import { describe, expect, it } from "bun:test";
import {
  parseRunningHelpers,
  reapOrphanHelpers,
  selectOrphanHelpers,
  type RunningHelper,
} from "../orphan-helpers";
import type { CommandResult, HostCommands } from "../runtime/host-commands";

const UDID_A = "EE6C68EA-16D0-423D-B952-DAB05C7B72B9";
const UDID_B = "9AE9BA38-4FBC-4D35-AA3E-26E44219757A";

function psLine(
  pid: number,
  udid: string,
  port: number,
  binary = "headless-serve-sim-bin",
): string {
  return `${pid} /Users/dev/serve-sim/dist/${binary} ${udid} --port ${port}`;
}

function stubHost(overrides: Partial<HostCommands> & { ps?: string } = {}): {
  host: HostCommands;
  signalled: Array<{ pid: number; signal: string | 0 }>;
} {
  const signalled: Array<{ pid: number; signal: string | 0 }> = [];
  const host: HostCommands = {
    run: ((_request: unknown, mode?: "sync") => {
      const result: CommandResult = {
        stdout: Buffer.from(overrides.ps ?? ""),
        stderr: Buffer.from(""),
        exitCode: 0,
        signal: null,
        timedOut: false,
      } as CommandResult;
      return mode === "sync" ? result : Promise.resolve(result);
    }) as HostCommands["run"],
    start: (() => {
      throw new Error("not used");
    }) as HostCommands["start"],
    signal: (pid: number, signal: NodeJS.Signals | 0) => {
      signalled.push({ pid, signal });
      return true;
    },
    ...(overrides as object),
  } as HostCommands;
  return { host, signalled };
}

describe("parseRunningHelpers", () => {
  it("extracts pid and device from helper command lines", () => {
    const output = [psLine(101, UDID_A, 3100), psLine(202, UDID_B, 3101)].join("\n");
    expect(parseRunningHelpers(output)).toEqual([
      { pid: 101, udid: UDID_A },
      { pid: 202, udid: UDID_B },
    ]);
  });

  it("ignores processes that are not the helper", () => {
    const output = [
      "1 /sbin/launchd",
      "42 node /Users/dev/project/server.js --port 3100",
      psLine(101, UDID_A, 3100),
      "77 /Applications/Simulator.app/Contents/MacOS/Simulator",
    ].join("\n");
    expect(parseRunningHelpers(output)).toEqual([{ pid: 101, udid: UDID_A }]);
  });

  it("skips its own pid so a reaper never signals itself", () => {
    const output = [psLine(101, UDID_A, 3100), psLine(999, UDID_A, 3101)].join("\n");
    expect(parseRunningHelpers(output, 999)).toEqual([{ pid: 101, udid: UDID_A }]);
  });

  it("tolerates blank and malformed lines", () => {
    const output = ["", "   ", "notapid something", psLine(5, UDID_A, 3100)].join("\n");
    expect(parseRunningHelpers(output)).toEqual([{ pid: 5, udid: UDID_A }]);
  });

  it("matches the cached hashed binary name the CLI actually spawns", () => {
    const output = psLine(7, UDID_A, 3100, "headless-serve-sim-bin-cc89af13b27d96ce");
    expect(parseRunningHelpers(output)).toEqual([{ pid: 7, udid: UDID_A }]);
  });

  it("normalizes device case so a lowercase command line still matches", () => {
    const output = psLine(9, UDID_A.toLowerCase(), 3100);
    expect(parseRunningHelpers(output)).toEqual([{ pid: 9, udid: UDID_A }]);
  });
});

describe("selectOrphanHelpers", () => {
  const running: RunningHelper[] = [
    { pid: 101, udid: UDID_A },
    { pid: 202, udid: UDID_A },
    { pid: 303, udid: UDID_B },
  ];

  it("treats a helper named by a live state file as tracked", () => {
    expect(selectOrphanHelpers(running, new Set([101, 303]))).toEqual([{ pid: 202, udid: UDID_A }]);
  });

  it("returns nothing when every helper is accounted for", () => {
    expect(selectOrphanHelpers(running, new Set([101, 202, 303]))).toEqual([]);
  });

  it("scopes to one device when asked", () => {
    expect(selectOrphanHelpers(running, new Set(), { udid: UDID_B })).toEqual([
      { pid: 303, udid: UDID_B },
    ]);
  });

  it("matches the requested device case-insensitively", () => {
    expect(selectOrphanHelpers(running, new Set(), { udid: UDID_B.toLowerCase() })).toEqual([
      { pid: 303, udid: UDID_B },
    ]);
  });

  it("reports every untracked helper — the accumulation this exists to stop", () => {
    const many = Array.from({ length: 22 }, (_, i) => ({ pid: 100 + i, udid: UDID_A }));
    expect(selectOrphanHelpers(many, new Set([100]))).toHaveLength(21);
  });
});

describe("reapOrphanHelpers", () => {
  it("SIGTERMs untracked helpers for the requested device only", () => {
    const ps = [
      psLine(101, UDID_A, 3100),
      psLine(202, UDID_A, 3101),
      psLine(303, UDID_B, 3102),
    ].join("\n");
    const { host, signalled } = stubHost({ ps });
    const reaped = reapOrphanHelpers(host, new Set([101]), { udid: UDID_A, selfPid: 1 });
    expect(reaped).toEqual([202]);
    expect(signalled).toEqual([{ pid: 202, signal: "SIGTERM" }]);
  });

  it("leaves a tracked helper alone", () => {
    const { host, signalled } = stubHost({ ps: psLine(101, UDID_A, 3100) });
    expect(reapOrphanHelpers(host, new Set([101]), { udid: UDID_A, selfPid: 1 })).toEqual([]);
    expect(signalled).toEqual([]);
  });

  it("reports each reaped helper to the caller", () => {
    const seen: RunningHelper[] = [];
    const { host } = stubHost({ ps: psLine(202, UDID_A, 3101) });
    reapOrphanHelpers(host, new Set(), { selfPid: 1, onReap: (h) => seen.push(h) });
    expect(seen).toEqual([{ pid: 202, udid: UDID_A }]);
  });

  it("does not report a helper whose signal failed", () => {
    const seen: RunningHelper[] = [];
    const { host } = stubHost({ ps: psLine(202, UDID_A, 3101), signal: () => false });
    expect(reapOrphanHelpers(host, new Set(), { selfPid: 1, onReap: (h) => seen.push(h) })).toEqual(
      [],
    );
    expect(seen).toEqual([]);
  });

  it("stays quiet when the process listing fails", () => {
    const host = {
      run: (() => {
        throw new Error("ps unavailable");
      }) as HostCommands["run"],
      start: (() => {
        throw new Error("not used");
      }) as HostCommands["start"],
      signal: () => true,
    } as HostCommands;
    expect(reapOrphanHelpers(host, new Set(), { selfPid: 1 })).toEqual([]);
  });
});
