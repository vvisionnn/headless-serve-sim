import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  toggleCachedSimulatorAppearance,
  toggleSimulatorAppearance,
} from "../client/utils/simulator-appearance";
import {
  cachedSimulatorSettings,
  clearSimulatorSettingsCache,
  SETTINGS_FRESH_MS,
  settingsRevision,
  storeSimulatorSettings,
} from "../client/utils/simulator-settings-cache";
import type { ExecResult } from "../client/utils/exec";

/** A simulator whose appearance only changes when it's set. */
function simulator(initial: string) {
  const sim = {
    appearance: initial,
    commands: [] as string[],
    fail: false,
    exec: async (command: string): Promise<ExecResult> => {
      sim.commands.push(command);
      const set = command.match(/appearance (\w+)$/);
      if (set && sim.fail) return result("", 1, "set failed");
      if (set) sim.appearance = set[1]!;
      return result(set ? "" : `${sim.appearance}\n`);
    },
  };
  return sim;
}

describe("toggleCachedSimulatorAppearance", () => {
  beforeEach(() => clearSimulatorSettingsCache());
  afterEach(() => setSystemTime());

  test("a fresh read is trusted: the toggle moves at once and takes one exec", async () => {
    const sim = simulator("light");
    storeSimulatorSettings("U", { appearance: "light" }, settingsRevision("U"));
    const done = toggleCachedSimulatorAppearance("U", sim.exec, () => {});
    expect(cachedSimulatorSettings("U")?.appearance).toBe("dark");
    await expect(done).resolves.toBe("dark");
    expect(sim.commands).toEqual(["xcrun simctl ui U appearance dark"]);
  });

  test("a stale cache is read first, so a change made elsewhere still toggles", async () => {
    setSystemTime(new Date(1_000_000));
    storeSimulatorSettings("U", { appearance: "light" }, settingsRevision("U"));
    const sim = simulator("dark"); // changed outside this tab
    setSystemTime(new Date(1_000_000 + SETTINGS_FRESH_MS + 1));
    await toggleCachedSimulatorAppearance("U", sim.exec, () => {});
    expect(sim.appearance).toBe("light");
    expect(cachedSimulatorSettings("U")?.appearance).toBe("light");
  });

  test("a failed toggle rolls the optimistic change back", async () => {
    const sim = simulator("light");
    storeSimulatorSettings("U", { appearance: "light" }, settingsRevision("U"));
    sim.fail = true;
    await expect(toggleCachedSimulatorAppearance("U", sim.exec, () => {})).rejects.toThrow(
      "set failed",
    );
    expect(cachedSimulatorSettings("U")?.appearance).toBe("light");
    sim.fail = false;
    await toggleCachedSimulatorAppearance("U", sim.exec, () => {});
    expect(sim.appearance).toBe("dark");
  });

  test("two quick presses toggle twice", async () => {
    const sim = simulator("light");
    storeSimulatorSettings("U", { appearance: "light" }, settingsRevision("U"));
    const first = toggleCachedSimulatorAppearance("U", sim.exec, () => {});
    const second = toggleCachedSimulatorAppearance("U", sim.exec, () => {});
    await Promise.all([first, second]);
    expect(sim.appearance).toBe("light");
    expect(cachedSimulatorSettings("U")?.appearance).toBe("light");
  });
});

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

  test("a known current appearance takes one exec, with no read first", async () => {
    const commands: string[] = [];
    const exec = async (command: string) => {
      commands.push(command);
      return result();
    };

    await expect(toggleSimulatorAppearance("DEVICE", exec, () => {}, "light")).resolves.toBe(
      "dark",
    );
    expect(commands).toEqual(["xcrun simctl ui DEVICE appearance dark"]);
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
