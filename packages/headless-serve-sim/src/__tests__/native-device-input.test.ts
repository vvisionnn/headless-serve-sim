import { expect, test } from "bun:test";
import { routeNativeDeviceInput } from "../native-device-input";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

test("Duo CLI rotation and buttons use native guest input while ordinary devices keep WebSocket routing", async () => {
  const events: unknown[] = [];
  const motion = {
    setOrientation: async (...args: unknown[]) => {
      events.push(args);
    },
    sendConsumer: async (...args: unknown[]) => {
      events.push(args);
    },
  };
  const host = createScriptedHostCommands([
    {
      result: {
        stdout: JSON.stringify({
          devices: {
            iOS: [
              {
                udid: "DUO",
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo",
              },
            ],
          },
        }),
      },
    },
  ]);
  expect(await routeNativeDeviceInput(host, "DUO", { orientation: "landscape_left" }, motion)).toBe(
    true,
  );
  expect(events).toEqual([["DUO", "landscapeRight"]]);
  const buttons = createScriptedHostCommands([
    {
      result: {
        stdout: JSON.stringify({
          devices: {
            iOS: [
              {
                udid: "DUO",
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo",
              },
            ],
          },
        }),
      },
    },
  ]);
  expect(await routeNativeDeviceInput(buttons, "DUO", { button: "lock" }, motion)).toBe(true);
  expect(events.at(-1)).toEqual(["DUO", 12, 0x30, "press"]);
  const ordinary = createScriptedHostCommands([
    {
      result: {
        stdout: JSON.stringify({
          devices: {
            iOS: [
              {
                udid: "PHONE",
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
              },
            ],
          },
        }),
      },
    },
  ]);
  expect(await routeNativeDeviceInput(ordinary, "PHONE", { orientation: "portrait" }, motion)).toBe(
    false,
  );
  expect(events).toHaveLength(2);
});
