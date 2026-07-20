import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamModeToggle } from "../client/components/stream-mode-toggle";

describe("StreamModeToggle", () => {
  test("renders controlled Perf/Quality state and disconnected disabling", () => {
    const html = renderToStaticMarkup(
      <StreamModeToggle label="Stream quality" mode="quality" disabled onModeChange={() => {}} />,
    );

    expect(html).toContain('aria-label="Stream quality"');
    expect(html).toMatch(/aria-checked="true"[^>]*disabled=""[^>]*>Quality/);
    expect(html).toMatch(/aria-checked="false"[^>]*disabled=""[^>]*>Perf/);
  });
});
