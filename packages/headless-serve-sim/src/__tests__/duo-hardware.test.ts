import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { duoHardwareCommands } from "../client/utils/duo-hardware";
import { HIDUsage } from "../client/utils/hid-usage";

test("Duo hardware uses the canonical HID usage catalog", async () => {
  const source = await readFile(
    new URL("../client/utils/duo-hardware.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain('from "./hid-usage"');
});

test("Duo named buttons use guest consumer events with held phases", () => {
  expect(duoHardwareCommands({ button: "lock" })).toEqual([
    { usagePage: 12, usage: 0x30, phase: "press" },
  ]);
  expect(duoHardwareCommands({ button: "volume_up", phase: "down" })).toEqual([
    { usagePage: 12, usage: 0xe9, phase: "down" },
  ]);
  expect(duoHardwareCommands({ usagePage: 12, usage: 0xea, phase: "up" })).toEqual([
    { usagePage: 12, usage: 0xea, phase: "up" },
  ]);
  expect(duoHardwareCommands({ button: "app_switcher" })).toEqual([
    { usagePage: 12, usage: 0x40, phase: "press" },
    { usagePage: 12, usage: 0x40, phase: "press" },
  ]);
  for (const [button, usage] of [
    ["lock", HIDUsage.power],
    ["side_button", HIDUsage.power],
    ["siri", HIDUsage.voiceCommand],
    ["volume_up", HIDUsage.volumeUp],
    ["volume_down", HIDUsage.volumeDown],
    ["app_switcher", HIDUsage.menu],
  ] as const) {
    for (const phase of ["down", "up", "press"] as const) {
      const command = { usagePage: HIDUsage.consumerPage, usage, phase };
      expect(duoHardwareCommands({ button, phase })).toEqual(
        button === "app_switcher" ? [command, command] : [command],
      );
    }
  }
  expect(
    duoHardwareCommands({
      button: "lock",
      usagePage: HIDUsage.consumerPage,
      usage: 0,
      phase: "up",
    }),
  ).toEqual([{ usagePage: HIDUsage.consumerPage, usage: 0, phase: "up" }]);
  expect(duoHardwareCommands({ button: "home" })).toBeNull();
  expect(duoHardwareCommands({ button: "swipe_home" })).toBeNull();
});
