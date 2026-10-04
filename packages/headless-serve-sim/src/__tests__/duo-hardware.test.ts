import { expect, test } from "bun:test";
import { duoHardwareCommands } from "../client/utils/duo-hardware";

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
  expect(duoHardwareCommands({ button: "home" })).toBeNull();
  expect(duoHardwareCommands({ button: "swipe_home" })).toBeNull();
});
