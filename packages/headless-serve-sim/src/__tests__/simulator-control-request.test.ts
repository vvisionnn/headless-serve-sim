import { expect, test } from "bun:test";
import { handleSimulatorControlRequest } from "../simulator-control-request";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";
import { createDeviceClipboard } from "../device-clipboard";

const json = (result: unknown) => ({ result: { stdout: JSON.stringify({ result }) } });
const stateSteps = () => [
  json({
    volume: 42,
    audioInputDevice: { systemDefault: {} },
    audioOutputDevice: { device: { _0: "speaker:1" } },
  }),
  json({ inputDevices: [], outputDevices: [{ name: "Speakers", uid: "speaker:1" }] }),
  json({ biometrics: [{ type: "Touch ID", enabled: true }] }),
  json({ deviceOrientation: "faceUp" }),
  json({ liquidGlassOpacity: 0.37 }),
  { result: { stdout: "com.apple.coredevice.dtuhidd.active 0\n" } },
];

test("sets normalized volume through native arguments and returns fresh state", async () => {
  const commands = createScriptedHostCommands([json({}), ...stateSteps()]);
  const reply = await handleSimulatorControlRequest(commands, {
    device: "DUO",
    option: "volume",
    value: 0.42,
  });
  expect(commands.calls[0]?.request.args).toEqual([
    "devicectl",
    "device",
    "settings",
    "audio",
    "--device",
    "DUO",
    "--volume",
    "42",
    "--quiet",
    "--json-output",
    "-",
    "--timeout",
    "10",
  ]);
  expect(reply.state.audio?.volume).toBe(0.42);
  expect(reply.state.audio?.outputDevice).toBe("speaker:1");
  expect(reply.state.orientation).toBe("faceUp");
});

test("sets continuous Liquid Glass opacity without rounding and returns observed state", async () => {
  for (const value of [0, 0.375, 1]) {
    const commands = createScriptedHostCommands([json({}), ...stateSteps()]);
    const reply = await handleSimulatorControlRequest(commands, {
      device: "DUO",
      option: "liquid-glass-opacity",
      value,
    });
    expect(commands.calls[0]?.request.args).toEqual([
      "devicectl",
      "device",
      "settings",
      "appearance",
      "--device",
      "DUO",
      "--liquid-glass-opacity",
      String(value),
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "10",
    ]);
    expect(reply.state.appearance?.liquidGlassOpacity).toBe(0.37);
  }
});

test("rejects malformed settings before running any host command", async () => {
  for (const payload of [
    null,
    {},
    { device: "--help" },
    { device: "DUO;bad" },
    { device: "DUO", option: "volume", value: -0.1 },
    { device: "DUO", option: "volume", value: 1.1 },
    { device: "DUO", option: "volume", value: "0.5" },
    { device: "DUO", option: "volume", value: NaN },
    { device: "DUO", option: "unknown", value: true },
    { device: "DUO", option: "orientation", value: "upside" },
    { device: "DUO", option: "biometrics-enrolled", value: "on" },
    { device: "DUO", option: "biometric-match", value: "maybe" },
    { device: "DUO", option: "audio-input", value: "" },
    { device: "DUO", option: "audio-output", value: "--quiet" },
  ]) {
    const commands = createScriptedHostCommands();
    await expect(handleSimulatorControlRequest(commands, payload)).rejects.toThrow();
    expect(commands.calls).toHaveLength(0);
  }
});

test("rejects opacity outside finite numeric zero to one before launching commands", async () => {
  for (const value of [undefined, null, "0.5", -0.1, 1.1, NaN, Infinity, -Infinity]) {
    const commands = createScriptedHostCommands();
    await expect(
      handleSimulatorControlRequest(commands, {
        device: "DUO",
        option: "liquid-glass-opacity",
        value,
      }),
    ).rejects.toThrow("Liquid Glass opacity must be between 0 and 1");
    expect(commands.calls).toHaveLength(0);
  }
});

test("routes audio devices, biometric events and all six orientations through native commands", async () => {
  const cases: Array<[string, unknown, string[]]> = [
    ["audio-input", "mic:1", ["settings", "audio", "--input-device", "mic:1"]],
    ["audio-output", "systemDefault", ["settings", "audio", "--output-device", "systemDefault"]],
    ["biometrics-enrolled", true, ["settings", "biometrics", "--enable"]],
    ["biometrics-enrolled", false, ["settings", "biometrics", "--disable"]],
    ["biometric-match", true, ["simulate", "biometrics", "--success"]],
    ["biometric-match", false, ["simulate", "biometrics", "--failure"]],
    ...[
      "portrait",
      "portraitUpsideDown",
      "landscapeLeft",
      "landscapeRight",
      "faceUp",
      "faceDown",
    ].map((value): [string, unknown, string[]] => [
      "orientation",
      value,
      ["orientation", "set", value],
    ]),
  ];
  for (const [option, value, [group, command, ...args]] of cases) {
    const commands = createScriptedHostCommands([json({}), ...stateSteps()]);
    await handleSimulatorControlRequest(commands, { device: "DUO", option, value });
    expect(commands.calls[0]?.request.args).toEqual([
      "devicectl",
      "device",
      group!,
      command!,
      "--device",
      "DUO",
      ...args,
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "10",
    ]);
  }
});

test("routes explicit clipboard transfers without leaking contents to the browser", async () => {
  for (const [option, direction] of [
    ["clipboard-send", "to"],
    ["clipboard-get", "from"],
  ] as const) {
    const host = createScriptedHostCommands([
      { result: { stdout: "private clipboard contents" } },
      ...stateSteps(),
    ]);
    const clipboard = createDeviceClipboard(host);
    const reply = await handleSimulatorControlRequest(host, { device: "DUO", option }, clipboard);
    expect(host.calls[0]?.request.args?.slice(0, 5)).toEqual([
      "devicectl",
      "device",
      "pasteboard",
      "transfer",
      direction,
    ]);
    expect(JSON.stringify(reply)).not.toContain("private clipboard contents");
    expect(reply.state.sharedClipboard).toBe(false);
    clipboard.dispose();
  }
});

test("clipboard sharing is opt-in session state rather than an implicit query side effect", async () => {
  const host = createScriptedHostCommands([
    ...stateSteps(),
    { pid: 101, holdUntilStopped: true },
    ...stateSteps(),
    ...stateSteps(),
  ]);
  const clipboard = createDeviceClipboard(host);
  const initial = await handleSimulatorControlRequest(host, { device: "DUO" }, clipboard);
  expect(initial.state.sharedClipboard).toBe(false);
  expect(host.calls.every((call) => call.kind === "run")).toBe(true);
  const enabled = await handleSimulatorControlRequest(
    host,
    { device: "DUO", option: "shared-clipboard", value: true },
    clipboard,
  );
  expect(enabled.state.sharedClipboard).toBe(true);
  const disabled = await handleSimulatorControlRequest(
    host,
    { device: "DUO", option: "shared-clipboard", value: false },
    clipboard,
  );
  expect(disabled.state.sharedClipboard).toBe(false);
  expect(host.signals).toEqual([{ pid: 101, signal: "SIGTERM" }]);
  clipboard.dispose();
});
