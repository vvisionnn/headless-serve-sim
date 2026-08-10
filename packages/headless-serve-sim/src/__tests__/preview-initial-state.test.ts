import { describe, expect, test } from "bun:test";
import {
  paneInitiallyOpen,
  parsePreviewPanes,
  parseSimulatorTheme,
  PREVIEW_PANES,
} from "../preview-initial-state";

describe("parsePreviewPanes", () => {
  test("parses a single pane", () => {
    expect(parsePreviewPanes("devices")).toEqual(["devices"]);
  });

  test("parses a comma-separated list", () => {
    expect(parsePreviewPanes("devices,logs")).toEqual(["devices", "logs"]);
  });

  test("tolerates whitespace and casing", () => {
    expect(parsePreviewPanes(" Devices , LOGS ")).toEqual(["devices", "logs"]);
  });

  test("deduplicates repeats", () => {
    expect(parsePreviewPanes("logs,logs")).toEqual(["logs"]);
  });

  test("'none' alone means an explicitly empty layout", () => {
    expect(parsePreviewPanes("none")).toEqual([]);
  });

  // "none,logs" is a contradiction. Silently picking a reading would open a
  // layout the user did not ask for, so it has to be rejected.
  test("rejects 'none' combined with a pane", () => {
    expect(() => parsePreviewPanes("none,logs")).toThrow();
    expect(() => parsePreviewPanes("logs,none")).toThrow();
  });

  test("rejects an unknown pane and names it", () => {
    expect(() => parsePreviewPanes("nonsense")).toThrow(/nonsense/);
  });

  test("rejects an empty value", () => {
    expect(() => parsePreviewPanes("")).toThrow();
    expect(() => parsePreviewPanes(" , ")).toThrow();
  });

  test("accepts every advertised pane", () => {
    // The help text lists PREVIEW_PANES; each must actually parse.
    for (const pane of PREVIEW_PANES) {
      expect(parsePreviewPanes(pane)).toEqual([pane]);
    }
    expect(parsePreviewPanes(PREVIEW_PANES.join(","))).toEqual([...PREVIEW_PANES]);
  });
});

describe("parseSimulatorTheme", () => {
  test("accepts light and dark", () => {
    expect(parseSimulatorTheme("light")).toBe("light");
    expect(parseSimulatorTheme("dark")).toBe("dark");
  });

  test("tolerates whitespace and casing", () => {
    expect(parseSimulatorTheme(" Dark ")).toBe("dark");
  });

  test("rejects anything else", () => {
    expect(() => parseSimulatorTheme("auto")).toThrow();
    expect(() => parseSimulatorTheme("")).toThrow();
  });
});

describe("paneInitiallyOpen", () => {
  // The distinction that matters: absent `panes` means "no launch preference",
  // so the persisted default stands. An explicit empty list from
  // `--panes none` means "start closed" and must override it.
  test("no launch state leaves the persisted default alone", () => {
    expect(paneInitiallyOpen(undefined, "logs", true)).toBe(true);
    expect(paneInitiallyOpen(undefined, "logs", false)).toBe(false);
  });

  test("launch state without panes leaves the persisted default alone", () => {
    expect(paneInitiallyOpen({}, "logs", true)).toBe(true);
  });

  test("an explicit empty list closes panes the user had persisted open", () => {
    expect(paneInitiallyOpen({ panes: [] }, "logs", true)).toBe(false);
  });

  test("a named pane opens even when persisted closed", () => {
    expect(paneInitiallyOpen({ panes: ["logs"] }, "logs", false)).toBe(true);
  });

  test("an unnamed pane closes even when persisted open", () => {
    expect(paneInitiallyOpen({ panes: ["devices"] }, "logs", true)).toBe(false);
  });
});
