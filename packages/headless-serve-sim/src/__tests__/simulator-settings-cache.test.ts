import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  cachedSimulatorSettings,
  clearSimulatorSettingsCache,
  confirmSimulatorSetting,
  freshSimulatorSetting,
  patchSimulatorSettings,
  SETTINGS_FRESH_MS,
  SETTINGS_WARM_MS,
  settingsRevision,
  storeSimulatorSettings,
  subscribeSimulatorSettings,
  warmSimulatorSettings,
} from "../client/utils/simulator-settings-cache";

beforeEach(() => clearSimulatorSettingsCache());

describe("simulator settings cache", () => {
  test("a simulator never read has nothing cached", () => {
    expect(cachedSimulatorSettings("A")).toBeNull();
  });

  test("the last read survives for each simulator, so a remount or switch shows it at once", () => {
    storeSimulatorSettings("A", { appearance: "dark" }, settingsRevision("A"));
    storeSimulatorSettings("B", { appearance: "light" }, settingsRevision("B"));
    expect(cachedSimulatorSettings("A")).toEqual({ appearance: "dark" });
    expect(cachedSimulatorSettings("B")).toEqual({ appearance: "light" });
  });

  test("a later read replaces the cached one", () => {
    storeSimulatorSettings("A", { appearance: "dark" }, settingsRevision("A"));
    storeSimulatorSettings("A", { appearance: "light" }, settingsRevision("A"));
    expect(cachedSimulatorSettings("A")).toEqual({ appearance: "light" });
  });

  test("an optimistic change lands at once and keeps the other values", () => {
    storeSimulatorSettings("A", { appearance: "light", voiceover: "off" }, settingsRevision("A"));
    patchSimulatorSettings("A", { appearance: "dark" });
    expect(cachedSimulatorSettings("A")).toEqual({ appearance: "dark", voiceover: "off" });
  });

  test("a change for a simulator never read doesn't invent its other values", () => {
    patchSimulatorSettings("A", { appearance: "dark" });
    expect(cachedSimulatorSettings("A")).toBeNull();
  });

  test("a read that started before a change can't undo it", () => {
    storeSimulatorSettings("A", { appearance: "light" }, settingsRevision("A"));
    const startedAt = settingsRevision("A");
    patchSimulatorSettings("A", { appearance: "dark" });
    expect(storeSimulatorSettings("A", { appearance: "light" }, startedAt)).toBe(false);
    expect(cachedSimulatorSettings("A")).toEqual({ appearance: "dark" });
  });

  test("subscribers hear every write", () => {
    let heard = 0;
    const off = subscribeSimulatorSettings(() => heard++);
    storeSimulatorSettings("A", { appearance: "light" }, settingsRevision("A"));
    patchSimulatorSettings("A", { appearance: "dark" });
    off();
    patchSimulatorSettings("A", { appearance: "light" });
    expect(heard).toBe(2);
  });
});

describe("fresh settings", () => {
  afterEach(() => setSystemTime());

  test("a read is trusted for a few seconds, then no longer", () => {
    setSystemTime(new Date(1_000_000));
    storeSimulatorSettings("A", { appearance: "dark" }, settingsRevision("A"));
    expect(freshSimulatorSetting("A", "appearance")).toBe("dark");
    setSystemTime(new Date(1_000_000 + SETTINGS_FRESH_MS + 1));
    expect(freshSimulatorSetting("A", "appearance")).toBeUndefined();
  });

  test("an optimistic change isn't fresh until the simulator confirms it", () => {
    storeSimulatorSettings("A", { appearance: "light", voiceover: "off" }, settingsRevision("A"));
    patchSimulatorSettings("A", { appearance: "dark" });
    expect(freshSimulatorSetting("A", "appearance")).toBeUndefined();
    expect(freshSimulatorSetting("A", "voiceover")).toBe("off");
    confirmSimulatorSetting("A", "appearance", "dark");
    expect(freshSimulatorSetting("A", "appearance")).toBe("dark");
  });

  test("a confirmation that a later change overtook isn't trusted", () => {
    storeSimulatorSettings("A", { appearance: "light" }, settingsRevision("A"));
    patchSimulatorSettings("A", { appearance: "dark" });
    patchSimulatorSettings("A", { appearance: "light" });
    confirmSimulatorSetting("A", "appearance", "dark");
    expect(freshSimulatorSetting("A", "appearance")).toBeUndefined();
  });
});

describe("warmSimulatorSettings", () => {
  afterEach(() => setSystemTime());

  test("reads a switch target once, then not again for a few seconds", async () => {
    setSystemTime(new Date(5_000_000));
    let reads = 0;
    const read = async () => {
      reads++;
      return { appearance: "dark" };
    };
    await warmSimulatorSettings("W", read);
    await warmSimulatorSettings("W", read);
    expect(reads).toBe(1);
    expect(cachedSimulatorSettings("W")).toEqual({ appearance: "dark" });
    setSystemTime(new Date(5_000_000 + SETTINGS_WARM_MS + 1));
    await warmSimulatorSettings("W", read);
    expect(reads).toBe(2);
  });

  test("never runs two reads for one simulator at once", async () => {
    setSystemTime(new Date(6_000_000));
    let reads = 0;
    let finish: (v: Record<string, string>) => void = () => {};
    const read = () => {
      reads++;
      return new Promise<Record<string, string>>((r) => (finish = r));
    };
    const first = warmSimulatorSettings("X", read);
    setSystemTime(new Date(6_000_000 + SETTINGS_WARM_MS + 1));
    void warmSimulatorSettings("X", read);
    expect(reads).toBe(1);
    finish({ voiceover: "on" });
    await first;
    expect(cachedSimulatorSettings("X")).toEqual({ voiceover: "on" });
  });

  test("a failed read is swallowed", async () => {
    await warmSimulatorSettings("Y", () => Promise.reject(new Error("socket closed")));
    expect(cachedSimulatorSettings("Y")).toBeNull();
  });
});
