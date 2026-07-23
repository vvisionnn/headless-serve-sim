import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { resolveNativeSourceRoot } from "../native-source-root";

const runtimeDir = "/workspace/packages/headless-serve-sim/dist";
const packagedSources = resolve(runtimeDir, "../dist/native-sources");
const workspaceSources = resolve(runtimeDir, "../../headless-serve-sim-binary/Sources");

describe("native source resolution", () => {
  test("uses the sources shipped beside an installed Node bundle", () => {
    expect(resolveNativeSourceRoot(runtimeDir, (path) => path === packagedSources)).toBe(
      packagedSources,
    );
  });

  test("prefers authoritative workspace sources during development", () => {
    expect(resolveNativeSourceRoot(runtimeDir, () => true)).toBe(workspaceSources);
  });

  test("returns null when neither source tree is available", () => {
    expect(resolveNativeSourceRoot(runtimeDir, () => false)).toBeNull();
  });
});
