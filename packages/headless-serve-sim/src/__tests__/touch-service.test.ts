import { expect, test } from "bun:test";
import { ensureTouchService } from "../touch-service";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

test("starts the simulator's touch service before input is attached", async () => {
  const host = createScriptedHostCommands([{}]);
  await ensureTouchService(host, "DEVICE");
  expect(host.calls.map((call) => [call.request.executable, ...(call.request.args ?? [])])).toEqual(
    [["xcrun", "simctl", "spawn", "DEVICE", "launchctl", "start", "com.apple.coredevice.dthidd"]],
  );
});

test("a failed start never blocks attaching the helper", async () => {
  const host = createScriptedHostCommands([{ result: { exitCode: 1, stderr: "no such job" } }]);
  await expect(ensureTouchService(host, "DEVICE")).resolves.toBeUndefined();
});
