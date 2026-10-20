import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SimulatorSettingsTool,
  TEXT_SIZE_CATEGORIES,
  fitsSegments,
  textSizeLabel,
} from "../client/components/simulator-settings-tool";
import { storeSimulatorSettings } from "../client/utils/simulator-settings-cache";

describe("textSizeLabel", () => {
  test("names every slider stop", () => {
    expect(TEXT_SIZE_CATEGORIES.map((_, i) => textSizeLabel(i))).toEqual([
      "Extra small",
      "Small",
      "Medium",
      "Large",
      "Extra large",
      "XX large",
      "XXX large",
    ]);
  });

  test("falls back to the stock size off the end", () => {
    expect(textSizeLabel(99)).toBe("Large");
  });
});

describe("fitsSegments", () => {
  test("a few short options lay out flat", () => {
    expect(
      fitsSegments([
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]),
    ).toBe(true);
  });

  test("long labels or long lists go behind a menu", () => {
    expect(fitsSegments([{ value: "red-green", label: "Red/Green (Protanopia)" }])).toBe(false);
    expect(fitsSegments(["a", "b", "c", "d", "e"].map((v) => ({ value: v, label: v })))).toBe(
      false,
    );
  });
});

describe("SimulatorSettingsTool", () => {
  test("renders Appearance and Accessibility, held inert at full colour until real state loads", () => {
    const html = renderToStaticMarkup(<SimulatorSettingsTool udid="U" />);
    expect(html).toContain(">Appearance</h3>");
    expect(html).toContain(">Accessibility</h3>");
    expect(html).toContain('role="radiogroup" aria-label="Appearance"');
    expect(html).toContain('role="radiogroup" aria-label="Liquid Glass"');
    expect(html).toMatch(/^<div inert="" aria-busy="true" class="contents">/);
    expect(html).toContain(
      '<div role="slider" aria-label="Text size" aria-valuemin="0" aria-valuemax="6" aria-valuenow="3"',
    );
    for (const label of [
      "Reduce motion",
      "Increase contrast",
      "Show borders",
      "Reduce transparency",
      "VoiceOver",
    ])
      expect(html).toContain(`role="switch" aria-checked="false" aria-label="${label}"`);
    // Nothing dims: dimmed stock values would snap to full colour on the read.
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("aria-disabled");
  });

  test("a simulator read before renders its last values, enabled, at once", () => {
    storeSimulatorSettings("CACHED", { appearance: "dark", voiceover: "on" }, 0);
    const html = renderToStaticMarkup(<SimulatorSettingsTool udid="CACHED" />);
    expect(html).toContain('role="switch" aria-checked="true" aria-label="VoiceOver"');
    expect(html).not.toContain('aria-label="VoiceOver" disabled=""');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("inert");
  });
});
