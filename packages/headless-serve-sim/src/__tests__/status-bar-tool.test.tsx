import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StatusBarTool,
  statusBarNumber,
  statusBarOptions,
} from "../client/components/status-bar-tool";

describe("statusBarOptions", () => {
  test("leads with an Unchanged entry that sends no override", () => {
    expect(statusBarOptions(["charging", "charged"])).toEqual([
      { value: "", label: "Unchanged" },
      { value: "charging", label: "Charging" },
      { value: "charged", label: "Charged" },
    ]);
  });

  test("names network values the way the status bar shows them", () => {
    const labels = statusBarOptions(["wifi", "lte-a", "5g-uwb"]).map((o) => o.label);
    expect(labels).toEqual(["Unchanged", "Wi‑Fi", "LTE‑A", "5G UW"]);
  });
});

describe("statusBarNumber", () => {
  test("shows the stock value for an unset field", () => {
    expect(statusBarNumber("", 4)).toBe(4);
  });

  test("shows the field's own value once set", () => {
    expect(statusBarNumber("0", 4)).toBe(0);
    expect(statusBarNumber("72", 100)).toBe(72);
  });
});

describe("StatusBarTool", () => {
  test("renders every override field, the keynote preset and apply/reset", () => {
    const html = renderToStaticMarkup(<StatusBarTool udid="U" defaultOpen />);
    for (const label of [
      'aria-label="Time"',
      'aria-label="Data network"',
      'aria-label="Cellular bars"',
      'aria-label="Cellular mode"',
      'aria-label="Wi‑Fi bars"',
      'aria-label="Wi‑Fi mode"',
      'aria-label="Operator name"',
      'aria-label="Battery state"',
      'role="slider" aria-label="Battery level"',
    ])
      expect(html).toContain(label);
    expect(html).toContain("9:41 Keynote");
    expect(html).toContain("Reset");
    expect(html).toContain("Apply");
  });
});
