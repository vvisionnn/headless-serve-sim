import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LogsPanel, SimLogRows } from "../client/components/logs-panel";
import type { SimLogEntry } from "../client/utils/sim-logs";

describe("LogsPanel", () => {
  test("renders the complete accessible control surface", () => {
    const html = renderToStaticMarkup(
      <LogsPanel
        open
        onClose={() => {}}
        endpoint="/logs?device=D&amp;token=T"
        width={640}
      />,
    );

    expect(html).toContain("Logs");
    expect(html).toContain('aria-label="Search logs"');
    expect(html).toContain('aria-label="Capture level"');
    expect(html).toContain('aria-label="Filter by process"');
    expect(html).toContain("Pause");
    expect(html).toContain("Clear");
    expect(html).toContain("Connecting");
  });
});

describe("SimLogRows", () => {
  test("escapes hostile messages and renders source metadata without HTML injection", () => {
    const entry: SimLogEntry = {
      id: "1",
      timestamp: "2026-07-11 09:41:00.123456+0800",
      process: "ExampleApp",
      subsystem: "com.example",
      category: "network",
      level: "error",
      message: '<script>alert("owned")</script>',
      byteSize: 32,
    };
    const html = renderToStaticMarkup(<SimLogRows entries={[entry]} />);

    expect(html).toContain("ExampleApp");
    expect(html).toContain("com.example:network");
    expect(html).toContain("error");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("owned")</script>');
  });
});
