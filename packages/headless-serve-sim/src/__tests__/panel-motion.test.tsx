import { describe, expect, test } from "bun:test";
import { Panel } from "../client/Panel";
import { renderToStaticMarkup } from "react-dom/server";

const cssPath = new URL("../client/global.css", import.meta.url);

describe("panel motion tokens", () => {
  test("global.css ships panel, accordion, and reduced-motion tokens", async () => {
    const css = await Bun.file(cssPath).text();
    expect(css).toContain("--panel-open-dur: 400ms");
    expect(css).toContain("--panel-close-dur: 350ms");
    expect(css).toContain("--panel-ease: cubic-bezier(0.22, 1, 0.36, 1)");
    expect(css).toContain("--acc-expand: 250ms");
    expect(css).toContain("--blur-small: 2px");
    expect(css).toContain(".ds-rail");
    expect(css).toContain(".t-acc-panel");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".ds-overlay-panel");
  });

  test("overlay Panel uses origin-aware open state instead of a hardcoded 0.3s ease", () => {
    const html = renderToStaticMarkup(
      <Panel open width={420}>
        stats
      </Panel>,
    );
    expect(html).toContain("ds-overlay-panel");
    expect(html).toContain('data-open="true"');
    expect(html).not.toContain("0.3s cubic-bezier(0.4,0,0.6,1)");
  });
});
