import { beforeEach, describe, expect, test } from "bun:test";
import {
  cachedSimulatorSettings,
  clearSimulatorSettingsCache,
  patchSimulatorSettings,
  settingsRevision,
  storeSimulatorSettings,
  subscribeSimulatorSettings,
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
