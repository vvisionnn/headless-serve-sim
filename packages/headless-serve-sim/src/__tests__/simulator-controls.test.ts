import { expect, test } from "bun:test";
import { DEVICE_ORIENTATIONS, getSimulatorControlState } from "../simulator-controls";
import { DEVICE_ORIENTATIONS as MOTION_ORIENTATIONS } from "../device-motion";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";
import type { CommandResult, HostCommands } from "../runtime/host-commands";

test("uses the same physical orientation catalog for control reads and motion writes", () => {
  expect(DEVICE_ORIENTATIONS).toBe(MOTION_ORIENTATIONS);
});

const json = (result: unknown) => ({ result: { stdout: JSON.stringify({ result }) } });

function simulatorControlStateSteps() {
  return [
    json({
      volume: 60,
      audioInputDevice: { systemDefault: {} },
      audioOutputDevice: { systemDefault: {} },
    }),
    json({
      inputDevices: [{ name: "Microphone", uid: "mic:1" }],
      outputDevices: [{ name: "Speakers", uid: "speaker:1" }],
    }),
    json({ biometrics: [{ type: "Touch ID", enabled: false }] }),
    json({ deviceOrientation: "portrait" }),
    json({ liquidGlassOpacity: 0.5 }),
    { result: { stdout: "com.apple.coredevice.dtuhidd.active 0\n" } },
  ];
}

test("starts all independent native state queries before any command settles", async () => {
  const scripted = createScriptedHostCommands(simulatorControlStateSteps());
  const releases: Array<() => void> = [];
  const host: HostCommands = {
    ...scripted,
    run: ((request) => {
      const result = scripted.run(request);
      return new Promise<CommandResult>((resolve, reject) => {
        releases.push(() => void result.then(resolve, reject));
      });
    }) as HostCommands["run"],
  };
  const result = getSimulatorControlState(host, "DUO");
  try {
    expect(scripted.calls).toHaveLength(6);
  } finally {
    for (let i = 0; i < 6; i++) {
      for (const release of releases.splice(0)) release();
      await Promise.resolve();
      await Promise.resolve();
    }
  }
  const state = await result;
  expect(state.errors).toEqual({});
  expect(state.audio?.volume).toBe(0.6);
  expect(state.appearance).toEqual({ liquidGlassOpacity: 0.5 });
  expect(state.inputAttachment).toEqual({ appleWindowActive: false });
});

test("bounds native devicectl work below the host command deadline", async () => {
  const commands = createScriptedHostCommands(simulatorControlStateSteps());
  await getSimulatorControlState(commands, "DUO");
  const nativeCalls = commands.calls.filter(({ request }) => request.args?.[0] === "devicectl");
  expect(nativeCalls).toHaveLength(5);
  for (const { request } of nativeCalls) {
    expect(request.args?.slice(-2)).toEqual(["--timeout", "10"]);
    expect(request.timeoutMs).toBe(15_000);
  }
});

test("reads normalized sound, supported biometrics and physical orientation from native JSON", async () => {
  const commands = createScriptedHostCommands(simulatorControlStateSteps());
  expect(await getSimulatorControlState(commands, "DUO")).toEqual({
    audio: {
      volume: 0.6,
      inputDevice: "systemDefault",
      outputDevice: "systemDefault",
      inputDevices: [
        { value: "systemDefault", label: "System Default" },
        { value: "mic:1", label: "Microphone" },
      ],
      outputDevices: [
        { value: "systemDefault", label: "System Default" },
        { value: "speaker:1", label: "Speakers" },
      ],
    },
    biometrics: [{ type: "Touch ID", enabled: false }],
    orientation: "portrait",
    appearance: { liquidGlassOpacity: 0.5 },
    inputAttachment: { appleWindowActive: false },
    errors: {},
  });
  expect(commands.calls.map(({ request }) => request.args)).toEqual([
    [
      "devicectl",
      "device",
      "info",
      "audio",
      "--device",
      "DUO",
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "10",
    ],
    ["devicectl", "list", "audioDevices", "--quiet", "--json-output", "-", "--timeout", "10"],
    [
      "devicectl",
      "device",
      "settings",
      "biometrics",
      "--device",
      "DUO",
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "10",
    ],
    [
      "devicectl",
      "device",
      "orientation",
      "get",
      "--device",
      "DUO",
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "10",
    ],
    [
      "devicectl",
      "device",
      "info",
      "appearance",
      "--device",
      "DUO",
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "10",
    ],
    ["simctl", "spawn", "DUO", "notifyutil", "-g", "com.apple.coredevice.dtuhidd.active"],
  ]);
  expect(
    commands.calls.every(
      ({ request }) => request.executable === "xcrun" && request.shell === undefined,
    ),
  ).toBe(true);
});

test("reads simulator window input attachment through a bounded read-only notification query", async () => {
  for (const value of [0, 1]) {
    const commands = createScriptedHostCommands([
      ...simulatorControlStateSteps().slice(0, 5),
      { result: { stdout: `com.apple.coredevice.dtuhidd.active ${value}\n` } },
    ]);
    const state = await getSimulatorControlState(commands, "DUO");
    expect(state.inputAttachment).toEqual({ appleWindowActive: value === 1 });
    expect(state.errors).toEqual({});
    expect(commands.calls.at(-1)?.request).toEqual({
      executable: "xcrun",
      args: ["simctl", "spawn", "DUO", "notifyutil", "-g", "com.apple.coredevice.dtuhidd.active"],
      stdio: "capture",
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
    });
  }
});

test("reports unknown input attachment instead of treating malformed notification output as inactive", async () => {
  for (const stdout of [
    "",
    "0",
    "1",
    "com.apple.coredevice.dtuhidd.active 2",
    "com.apple.coredevice.dtuhidd.active false",
    "other.notification 0",
    "com.apple.coredevice.dtuhidd.active 0\ncom.apple.coredevice.dtuhidd.active 1",
  ]) {
    const commands = createScriptedHostCommands([
      ...simulatorControlStateSteps().slice(0, 5),
      { result: { stdout } },
    ]);
    const state = await getSimulatorControlState(commands, "DUO");
    expect(state.inputAttachment).toBeNull();
    expect(state.errors.inputAttachment).toBe("Invalid input attachment state");
    expect(state.audio?.volume).toBe(0.6);
    expect(state.biometrics).toEqual([{ type: "Touch ID", enabled: false }]);
    expect(state.orientation).toBe("portrait");
    expect(state.appearance).toEqual({ liquidGlassOpacity: 0.5 });
  }
});

test("isolates failed or timed-out input attachment queries without hiding native controls", async () => {
  for (const result of [
    { exitCode: 1, stderr: "Device is unavailable" },
    { timedOut: true, stdout: "com.apple.coredevice.dtuhidd.active 0" },
  ]) {
    const commands = createScriptedHostCommands([
      ...simulatorControlStateSteps().slice(0, 5),
      { result },
    ]);
    const state = await getSimulatorControlState(commands, "DUO");
    expect(state.inputAttachment).toBeNull();
    expect(state.errors.inputAttachment).toBe(result.stderr ?? "Input attachment query failed");
    expect(state.audio?.volume).toBe(0.6);
    expect(state.biometrics).toEqual([{ type: "Touch ID", enabled: false }]);
    expect(state.orientation).toBe("portrait");
    expect(state.appearance).toEqual({ liquidGlassOpacity: 0.5 });
  }
});

test("retains other native settings when audio is unavailable", async () => {
  const commands = createScriptedHostCommands([
    { result: { exitCode: 1, stderr: "Audio is unsupported" } },
    ...simulatorControlStateSteps().slice(1),
  ]);
  expect(await getSimulatorControlState(commands, "DUO")).toEqual({
    audio: null,
    biometrics: [{ type: "Touch ID", enabled: false }],
    orientation: "portrait",
    appearance: { liquidGlassOpacity: 0.5 },
    inputAttachment: { appleWindowActive: false },
    errors: { audio: "Audio is unsupported" },
  });
});

test("does not enable controls for malformed native state", async () => {
  const commands = createScriptedHostCommands([
    json({ volume: "60", audioInputDevice: {}, audioOutputDevice: {} }),
    json({ inputDevices: [], outputDevices: [] }),
    json({ biometrics: [{ type: "Touch ID", enabled: "false" }] }),
    json({ deviceOrientation: "unknown" }),
    json({ liquidGlassOpacity: "0.5" }),
    { result: { stdout: "com.apple.coredevice.dtuhidd.active unknown" } },
  ]);
  const state = await getSimulatorControlState(commands, "DUO");
  expect(state.audio).toBeNull();
  expect(state.biometrics).toBeNull();
  expect(state.orientation).toBeNull();
  expect(state.appearance).toBeNull();
  expect(state.inputAttachment).toBeNull();
  expect(Object.keys(state.errors).sort()).toEqual([
    "appearance",
    "audio",
    "biometrics",
    "inputAttachment",
    "orientation",
  ]);
});

test("returns partial native state when any independent query reaches its deadline", async () => {
  const groups = [
    "audio",
    "audio",
    "biometrics",
    "orientation",
    "appearance",
    "inputAttachment",
  ] as const;
  for (const [index, group] of groups.entries()) {
    const commands = createScriptedHostCommands(
      simulatorControlStateSteps().map((step, stepIndex) =>
        stepIndex === index
          ? { result: { timedOut: true, stderr: "Native query timed out" } }
          : step,
      ),
    );
    const state = await getSimulatorControlState(commands, "DUO");
    expect(state[group]).toBeNull();
    expect(state.errors).toEqual({ [group]: "Native query timed out" });
    expect(commands.calls).toHaveLength(6);
    if (group !== "audio") expect(state.audio?.volume).toBe(0.6);
    if (group !== "biometrics")
      expect(state.biometrics).toEqual([{ type: "Touch ID", enabled: false }]);
    if (group !== "orientation") expect(state.orientation).toBe("portrait");
    if (group !== "appearance") expect(state.appearance).toEqual({ liquidGlassOpacity: 0.5 });
    if (group !== "inputAttachment")
      expect(state.inputAttachment).toEqual({ appleWindowActive: false });
  }
});

test("retains existing controls when native appearance query is unavailable", async () => {
  const commands = createScriptedHostCommands([
    ...simulatorControlStateSteps().slice(0, 4),
    { result: { exitCode: 1, stderr: "Appearance is unsupported" } },
    ...simulatorControlStateSteps().slice(5),
  ]);
  const state = await getSimulatorControlState(commands, "DUO");
  expect(state.appearance).toBeNull();
  expect(state.errors).toEqual({ appearance: "Appearance is unsupported" });
  expect(state.audio?.volume).toBe(0.6);
  expect(state.biometrics).toEqual([{ type: "Touch ID", enabled: false }]);
  expect(state.orientation).toBe("portrait");
});

test("rejects malformed opacity readback without hiding other native settings", async () => {
  for (const value of [undefined, null, "0.5", -0.1, 1.1, NaN, Infinity]) {
    const commands = createScriptedHostCommands([
      ...simulatorControlStateSteps().slice(0, 4),
      json({ liquidGlassOpacity: value }),
      ...simulatorControlStateSteps().slice(5),
    ]);
    const state = await getSimulatorControlState(commands, "DUO");
    expect(state.appearance).toBeNull();
    expect(state.errors.appearance).toBe("Invalid Liquid Glass opacity");
    expect(state.audio?.volume).toBe(0.6);
    expect(state.biometrics).toEqual([{ type: "Touch ID", enabled: false }]);
    expect(state.orientation).toBe("portrait");
  }
});
