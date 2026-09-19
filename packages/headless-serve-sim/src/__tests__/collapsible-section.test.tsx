import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleSection } from "../client/components/collapsible-section";

describe("CollapsibleSection", () => {
  test("closed section uses accordion panel hooks and data-open false", () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection open={false} onOpenChange={() => {}} summary="Simulator">
        <span>body</span>
      </CollapsibleSection>,
    );
    expect(html).toContain("t-acc");
    expect(html).toContain('data-open="false"');
    expect(html).toContain("t-acc-panel");
    expect(html).toContain("t-acc-panel-inner");
    expect(html).toContain("t-acc-chevron");
    expect(html).toContain("Simulator");
    expect(html).toContain("body");
  });

  test("open section sets data-open true and aria-expanded on the summary path", () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection open onOpenChange={() => {}} summary="Status Bar">
        <span>overrides</span>
      </CollapsibleSection>,
    );
    expect(html).toContain('data-open="true"');
    expect(html).toContain("open");
    expect(html).toContain("Status Bar");
  });
});
