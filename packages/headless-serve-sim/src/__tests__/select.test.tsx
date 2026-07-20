import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Select } from "../client/components/select";

// The custom <Select> backs the simulator-settings selects and (post-merge)
// the location / status-bar / user-defaults pickers. Its open listbox is
// portaled and effect-driven, so it isn't present in static markup — these
// tests cover the closed trigger, whose label-resolution + disabled handling
// is the shared surface every consumer relies on.
const APPEARANCE = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

describe("Select (custom dropdown)", () => {
  test("renders the selected option's label in the closed trigger", () => {
    const html = renderToStaticMarkup(
      <Select label="Appearance" value="dark" options={APPEARANCE} onChange={() => {}} />,
    );
    expect(html).toContain("Dark");
    // Closed: only the trigger renders — the (portaled) option list is absent,
    // so the unselected option's label must not appear.
    expect(html).not.toContain("Light");
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Appearance"');
  });

  test("falls back to the raw value when no option matches", () => {
    const html = renderToStaticMarkup(
      <Select label="Appearance" value="sepia" options={APPEARANCE} onChange={() => {}} />,
    );
    expect(html).toContain("sepia");
  });

  test("renders the empty-value label (status-bar 'unset')", () => {
    const html = renderToStaticMarkup(
      <Select
        label="Data network"
        value=""
        options={[
          { value: "", label: "unset" },
          { value: "lte", label: "lte" },
        ]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("unset");
  });

  test("disabled trigger is marked disabled and not expanded", () => {
    const html = renderToStaticMarkup(
      <Select label="Appearance" value="light" options={APPEARANCE} disabled onChange={() => {}} />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-expanded="false"');
  });
});
