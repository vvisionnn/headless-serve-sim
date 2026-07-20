import { describe, expect, test } from "bun:test";
import { toggleSimulatorAppearance } from "../client/utils/simulator-appearance";
import type { ExecResult } from "../client/utils/exec";

function result(stdout = "", exitCode = 0, stderr = ""): ExecResult {
  return { stdout, stderr, exitCode };
}

describe("toggleSimulatorAppearance", () => {
  test("toggles the selected simulator and notifies settings consumers after success", async () => {
    const commands: string[] = [];
    let changed = 0;
    const exec = async (command: string) => {
      commands.push(command);
      return commands.length === 1 ? result("dark\n") : result();
    };

    await expect(
      toggleSimulatorAppearance("DEVICE", exec, () => {
        changed++;
      }),
    ).resolves.toBe("light");

    expect(commands).toEqual([
      "xcrun simctl ui DEVICE appearance",
      "xcrun simctl ui DEVICE appearance light",
    ]);
    expect(changed).toBe(1);
  });

  test("does not notify settings consumers when the mutation fails", async () => {
    let changed = 0;
    const exec = async (command: string) =>
      command.endsWith(" appearance") ? result("light\n") : result("", 1, "set failed");

    await expect(
      toggleSimulatorAppearance("DEVICE", exec, () => {
        changed++;
      }),
    ).rejects.toThrow("set failed");
    expect(changed).toBe(0);
  });
});
