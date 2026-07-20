import { describe, expect, test } from "bun:test";
import {
  createDeviceDiscovery,
  pickDefaultStreamDeviceFromList,
  type SimctlDevicesJson,
} from "../device";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

function simctl(devices: SimctlDevicesJson["devices"]): SimctlDevicesJson {
  return { devices };
}

describe("pickDefaultStreamDeviceFromList", () => {
  test("prefers a shutdown iPhone over a booted iPhone in the newest runtime", () => {
    const picked = pickDefaultStreamDeviceFromList(
      simctl({
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          { udid: "BOOTED", name: "iPhone 17 Pro", state: "Booted" },
          { udid: "SHUTDOWN", name: "iPhone Air", state: "Shutdown" },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
          { udid: "OLDER", name: "iPhone 15 Pro", state: "Shutdown" },
        ],
      }),
    );

    expect(picked).toEqual({
      udid: "SHUTDOWN",
      name: "iPhone Air",
      state: "Shutdown",
    });
  });

  test("walks older runtimes instead of touching a booted simulator", () => {
    const picked = pickDefaultStreamDeviceFromList(
      simctl({
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          { udid: "BOOTED", name: "iPhone 17 Pro", state: "Booted" },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
          { udid: "OLDER", name: "iPhone 15 Pro", state: "Shutdown" },
        ],
      }),
    );

    expect(picked?.udid).toBe("OLDER");
  });

  test("walks older runtimes instead of touching a transient simulator", () => {
    const picked = pickDefaultStreamDeviceFromList(
      simctl({
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          { udid: "BOOTING", name: "iPhone 17 Pro", state: "Booting" },
          { udid: "SHUTTING_DOWN", name: "iPhone Air", state: "Shutting Down" },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
          { udid: "OLDER", name: "iPhone 15 Pro", state: "Shutdown" },
        ],
      }),
    );

    expect(picked?.udid).toBe("OLDER");
  });

  test("returns null when only non-shutdown iPhones are available", () => {
    const picked = pickDefaultStreamDeviceFromList(
      simctl({
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          { udid: "BOOTED", name: "iPhone 17 Pro", state: "Booted" },
          { udid: "CREATING", name: "iPhone Air", state: "Creating" },
        ],
      }),
    );

    expect(picked).toBeNull();
  });

  test("skips unavailable, non-iPhone, and non-iOS devices", () => {
    const picked = pickDefaultStreamDeviceFromList(
      simctl({
        "com.apple.CoreSimulator.SimRuntime.watchOS-26-2": [
          { udid: "WATCH", name: "Apple Watch Ultra", state: "Shutdown" },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          { udid: "IPAD", name: "iPad Pro", state: "Shutdown" },
          { udid: "UNAVAILABLE", name: "iPhone Air", state: "Shutdown", isAvailable: false },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
          { udid: "PHONE", name: "iPhone 15 Pro", state: "Shutdown" },
        ],
      }),
    );

    expect(picked?.udid).toBe("PHONE");
  });

  test("accepts custom-named iPhones by device type", () => {
    const picked = pickDefaultStreamDeviceFromList(
      simctl({
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
          {
            udid: "CUSTOM",
            name: "Project agent device",
            state: "Shutdown",
            deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
          },
        ],
      }),
    );

    expect(picked?.udid).toBe("CUSTOM");
  });
});

describe("device discovery", () => {
  test("finds an iOS booted simulator through injected host commands", () => {
    const host = createScriptedHostCommands([
      {
        result: {
          stdout: JSON.stringify({
            devices: {
              "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
                { udid: "WATCH", name: "Watch", state: "Booted" },
              ],
              "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
                { udid: "PHONE", name: "iPhone", state: "Booted" },
              ],
            },
          }),
        },
      },
    ]);

    expect(createDeviceDiscovery(host).findBootedDevice()).toBe("PHONE");
    expect(host.calls[0]).toMatchObject({
      kind: "run-sync",
      request: {
        executable: "xcrun",
        args: ["simctl", "list", "devices", "booted", "-j"],
      },
    });
  });

  test("resolves a UDID without invoking host commands", () => {
    const host = createScriptedHostCommands();
    const udid = "12345678-1234-1234-1234-123456789ABC";

    expect(createDeviceDiscovery(host).resolveDevice(udid)).toBe(udid);
    expect(host.calls).toEqual([]);
  });

  test("resolves a device name and lists shutdown defaults from scripted data", () => {
    const data = simctl({
      "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
        { udid: "PHONE", name: "iPhone My Phone", state: "Shutdown" },
      ],
    });
    const host = createScriptedHostCommands([
      { result: { stdout: JSON.stringify(data) } },
      { result: { stdout: JSON.stringify(data) } },
    ]);
    const discovery = createDeviceDiscovery(host);

    expect(discovery.resolveDevice("iphone my phone")).toBe("PHONE");
    expect(discovery.pickDefaultStreamDevices()).toEqual([
      { udid: "PHONE", name: "iPhone My Phone", state: "Shutdown" },
    ]);
  });

  test("fails closed when simulator discovery fails", () => {
    const host = createScriptedHostCommands([
      { result: { exitCode: 1, stderr: "xcode unavailable" } },
      { result: { exitCode: 1, stderr: "xcode unavailable" } },
    ]);
    const discovery = createDeviceDiscovery(host);

    expect(discovery.findBootedDevice()).toBeNull();
    expect(discovery.pickDefaultStreamDevices()).toEqual([]);
  });
});
