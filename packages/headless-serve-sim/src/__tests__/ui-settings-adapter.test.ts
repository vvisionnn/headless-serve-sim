import { describe, expect, test } from "bun:test";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";
import { createUiSettings, type UiOption } from "../ui-settings";

const DEVICE = "TEST-DEVICE";
const AX_TOOL = "/fixtures/headless-serve-sim-ax-settings";

function createSettings(outputs: readonly string[]) {
  const host = createScriptedHostCommands(outputs.map((stdout) => ({ result: { stdout } })));
  return {
    host,
    settings: createUiSettings(host, { locateAxSettingsTool: () => AX_TOOL }),
  };
}

describe("macOS UI settings adapter", () => {
  test.each([
    ["appearance", "dark", "dark"],
    ["text-size", "accessibility-medium", "accessibility-medium"],
    ["increase-contrast", "on", "enabled"],
    ["increase-contrast", "off", "disabled"],
  ] as const)("sets and reads native option %s as %s", async (option, value, nativeValue) => {
    const { host, settings } = createSettings(["", `${nativeValue}\n`]);

    await settings.set(DEVICE, option, value);
    await expect(settings.get(DEVICE, option)).resolves.toBe(value);

    const subcommand =
      option === "text-size"
        ? "content_size"
        : option === "increase-contrast"
          ? "increase_contrast"
          : "appearance";
    expect(host.calls.map((call) => call.request)).toEqual([
      {
        executable: "xcrun",
        args: ["simctl", "ui", DEVICE, subcommand, nativeValue],
        stdio: "capture",
        maxOutputBytes: 4 * 1024 * 1024,
      },
      {
        executable: "xcrun",
        args: ["simctl", "ui", DEVICE, subcommand],
        stdio: "capture",
        maxOutputBytes: 4 * 1024 * 1024,
      },
    ]);
  });

  test.each([
    ["liquid-glass", "tinted"],
    ["color-filter", "blue-yellow"],
    ["reduce-motion", "on"],
    ["show-borders", "on"],
    ["reduce-transparency", "on"],
    ["voiceover", "on"],
    ["voiceover", "off"],
  ] as const)(
    "sets and reads helper-backed option %s as %s without host side effects",
    async (option, value) => {
      const { host, settings } = createSettings(["", `${value}\n`]);

      await settings.set(DEVICE, option, value);
      await expect(settings.get(DEVICE, option)).resolves.toBe(value);

      expect(host.calls.map((call) => call.request)).toEqual([
        {
          executable: "xcrun",
          args: ["simctl", "spawn", DEVICE, AX_TOOL, "set", option, value],
          stdio: "capture",
          maxOutputBytes: 4 * 1024 * 1024,
        },
        {
          executable: "xcrun",
          args: ["simctl", "spawn", DEVICE, AX_TOOL, "get", option],
          stdio: "capture",
          maxOutputBytes: 4 * 1024 * 1024,
        },
      ]);
      expect(host.remaining).toBe(0);
    },
  );

  test("reports all nine options with one helper status request", async () => {
    const axStatus = {
      "liquid-glass": "clear",
      "color-filter": "none",
      "reduce-motion": "off",
      "show-borders": "off",
      "reduce-transparency": "off",
      voiceover: "off",
    };
    const { host, settings } = createSettings([
      "Dark\n",
      "Accessibility-Medium\n",
      "enabled\n",
      JSON.stringify(axStatus),
    ]);

    await expect(settings.status(DEVICE)).resolves.toEqual({
      appearance: "dark",
      "liquid-glass": "clear",
      "color-filter": "none",
      "text-size": "accessibility-medium",
      "reduce-motion": "off",
      "increase-contrast": "on",
      "show-borders": "off",
      "reduce-transparency": "off",
      voiceover: "off",
    });

    expect(host.calls.map((call) => call.request)).toEqual([
      {
        executable: "xcrun",
        args: ["simctl", "ui", DEVICE, "appearance"],
        stdio: "capture",
        maxOutputBytes: 4 * 1024 * 1024,
      },
      {
        executable: "xcrun",
        args: ["simctl", "ui", DEVICE, "content_size"],
        stdio: "capture",
        maxOutputBytes: 4 * 1024 * 1024,
      },
      {
        executable: "xcrun",
        args: ["simctl", "ui", DEVICE, "increase_contrast"],
        stdio: "capture",
        maxOutputBytes: 4 * 1024 * 1024,
      },
      {
        executable: "xcrun",
        args: ["simctl", "spawn", DEVICE, AX_TOOL, "status"],
        stdio: "capture",
        maxOutputBytes: 4 * 1024 * 1024,
      },
    ]);
  });

  test("surfaces captured host-command errors", async () => {
    const host = createScriptedHostCommands([
      { result: { exitCode: 1, stderr: "simulated settings failure" } },
    ]);
    const settings = createUiSettings(host, { locateAxSettingsTool: () => AX_TOOL });

    await expect(settings.get(DEVICE, "appearance")).rejects.toThrow("simulated settings failure");
  });

  test("rejects unknown options without issuing a host command", async () => {
    const { host, settings } = createSettings([]);

    await expect(settings.get(DEVICE, "sound" as UiOption)).rejects.toThrow(
      "unknown option: sound",
    );
    await expect(settings.set(DEVICE, "sound" as UiOption, "on")).rejects.toThrow(
      "unknown option: sound",
    );
    expect(host.calls).toEqual([]);
  });
});
