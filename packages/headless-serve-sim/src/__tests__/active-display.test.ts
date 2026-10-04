import { expect, test } from "bun:test";
import { activeDisplayId } from "../active-display";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

test("selects observed lit integrated display, not largest framebuffer", async () => {
  const host = createScriptedHostCommands([
    {
      result: {
        stdout: JSON.stringify({
          result: {
            displays: [
              { displayId: 3, active: false, backlightState: "off", type: { integrated: {} } },
              { displayId: 1, active: true, backlightState: "activeOn", type: { integrated: {} } },
            ],
          },
        }),
      },
    },
  ]);
  expect(await activeDisplayId(host, "DEVICE")).toBe("1");
});

test("lit display wins when CoreDevice active flags contradict backlight", async () => {
  const host = createScriptedHostCommands([
    {
      result: {
        stdout: JSON.stringify({
          result: {
            displays: [
              { displayId: 1, active: true, backlightState: "off", type: { integrated: {} } },
              { displayId: 3, active: false, backlightState: "activeOn", type: { integrated: {} } },
            ],
          },
        }),
      },
    },
  ]);
  expect(await activeDisplayId(host, "DEVICE")).toBe("3");
});

test("older Xcode without display discovery preserves default screenshots", async () => {
  const host = createScriptedHostCommands([
    { result: { exitCode: 64, stderr: "Unknown subcommand displays" } },
  ]);
  expect(await activeDisplayId(host, "DEVICE")).toBeUndefined();
});

test("malformed native display JSON preserves default screenshots", async () => {
  const host = createScriptedHostCommands([{ result: { stdout: "not JSON" } }]);
  expect(await activeDisplayId(host, "DEVICE")).toBeUndefined();
});
