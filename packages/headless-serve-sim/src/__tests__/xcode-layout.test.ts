import { describe, expect, test } from "bun:test";
import {
  resolveSimulatorApp,
  simulatorFrameworkDirs,
  withSimulatorFrameworkPath,
} from "../xcode-layout";

const xcode26 = "/Applications/Xcode-26.6.0.app/Contents/Developer";
const xcode27 = "/Applications/Xcode-27.0.0-Beta.4.app/Contents/Developer";

describe("simulator framework dirs", () => {
  test("offers both the Xcode 26 and Xcode 27 SimulatorKit locations", () => {
    expect(simulatorFrameworkDirs(xcode27)).toEqual([
      "/Applications/Xcode-27.0.0-Beta.4.app/Contents/Developer/Library/PrivateFrameworks",
      "/Applications/Xcode-27.0.0-Beta.4.app/Contents/SharedFrameworks",
    ]);
  });
});

describe("helper dyld env", () => {
  test("puts both framework dirs on DYLD_FRAMEWORK_PATH", () => {
    const env = withSimulatorFrameworkPath({}, xcode27);

    expect(env.DYLD_FRAMEWORK_PATH).toBe(
      "/Applications/Xcode-27.0.0-Beta.4.app/Contents/Developer/Library/PrivateFrameworks:" +
        "/Applications/Xcode-27.0.0-Beta.4.app/Contents/SharedFrameworks",
    );
  });

  test("appends an inherited DYLD_FRAMEWORK_PATH after the Xcode dirs", () => {
    const env = withSimulatorFrameworkPath({ DYLD_FRAMEWORK_PATH: "/opt/frameworks" }, xcode26);

    expect(env.DYLD_FRAMEWORK_PATH?.split(":")).toEqual([
      "/Applications/Xcode-26.6.0.app/Contents/Developer/Library/PrivateFrameworks",
      "/Applications/Xcode-26.6.0.app/Contents/SharedFrameworks",
      "/opt/frameworks",
    ]);
  });

  test("preserves the rest of the environment", () => {
    expect(withSimulatorFrameworkPath({ PATH: "/usr/bin" }, xcode27).PATH).toBe("/usr/bin");
  });
});

describe("gui simulator app", () => {
  const simulatorApp = `${xcode26}/Applications/Simulator.app`;
  const deviceHub = "/Applications/Xcode-27.0.0-Beta.4.app/Contents/Applications/DeviceHub.app";

  test("finds Simulator.app on Xcode 26", () => {
    expect(resolveSimulatorApp(xcode26, (path) => path === simulatorApp)).toBe(simulatorApp);
  });

  test("falls back to DeviceHub.app on Xcode 27", () => {
    expect(resolveSimulatorApp(xcode27, (path) => path === deviceHub)).toBe(deviceHub);
  });

  test("returns null when the toolchain ships no GUI app", () => {
    expect(resolveSimulatorApp(xcode27, () => false)).toBeNull();
  });
});
