import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { resolveUnembeddedHelperBinary } from "../helper-binary";

const runtimeDir = "/workspace/packages/headless-serve-sim/dist";
const packagedHelper = resolve(runtimeDir, "headless-serve-sim-bin");
const workspaceHelper = resolve(
  runtimeDir,
  "../../headless-serve-sim-binary/bin/headless-serve-sim-bin",
);

describe("unembedded helper binary resolution", () => {
  test("uses the executable packaged beside the Node bundle", () => {
    expect(resolveUnembeddedHelperBinary(runtimeDir, (path) => path === packagedHelper)).toBe(
      packagedHelper,
    );
  });

  test("falls back to the native workspace during source development", () => {
    expect(resolveUnembeddedHelperBinary(runtimeDir, (path) => path === workspaceHelper)).toBe(
      workspaceHelper,
    );
  });

  test("never returns a present but non-executable helper", () => {
    expect(resolveUnembeddedHelperBinary(runtimeDir, () => false)).toBeNull();
  });
});
