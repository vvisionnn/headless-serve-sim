import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RailCard } from "../client/components/rail-card";

describe("RailCard", () => {
  test("collapsed rail clips to the collapsed width and marks data-open false", () => {
    const html = renderToStaticMarkup(
      <RailCard
        open={false}
        collapsedWidth={52}
        expandedWidth={380}
        height={800}
        label="Inspector"
        from="right"
        header={<span>Inspector</span>}
      >
        <p>tools</p>
      </RailCard>,
    );
    expect(html).toContain("ds-rail");
    expect(html).toContain('data-open="false"');
    expect(html).toContain("ds-rail-body");
    expect(html).toContain("ds-rail-from-right");
    expect(html).toContain("width:52px");
    expect(html).toContain("aria-hidden");
    expect(html).not.toContain("320ms");
    expect(html).not.toContain("cubic-bezier(0.4, 0, 0.6, 1)");
  });

  test("expanded rail uses the expanded width and data-open true", () => {
    const html = renderToStaticMarkup(
      <RailCard
        open
        collapsedWidth={52}
        expandedWidth={380}
        height={800}
        label="Activity"
        from="left"
        header={<span>Activity</span>}
      >
        <p>gauges</p>
      </RailCard>,
    );
    expect(html).toContain('data-open="true"');
    expect(html).toContain("ds-rail-from-left");
    expect(html).toContain("width:380px");
    expect(html).toContain("gauges");
  });
});
