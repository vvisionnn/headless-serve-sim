import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsolePanel } from "../client/console/console-panel";
import { SimLogRows } from "../client/console/logs-view";
import { ShellContext, type ConsoleTab, type Shell } from "../client/shell/shell-context";
import type { SimLogEntry } from "../client/utils/sim-logs";

function renderConsole(consoleTab: ConsoleTab, logsEndpoint: string | undefined) {
  const shell = {
    consoleTab,
    consoleOpen: true,
    setConsoleTab: () => {},
    setConsoleOpen: () => {},
    axOverlayEnabled: false,
    toggleAxOverlay: () => {},
  } as unknown as Shell;
  return renderToStaticMarkup(
    <ShellContext value={shell}>
      <ConsolePanel
        udid="D"
        logsEndpoint={logsEndpoint}
        appProcessId={4242}
        devtools={{ targets: [], error: null, loading: false, refresh: async () => {} }}
        selectedDevtoolsTargetId={null}
        onSelectDevtoolsTarget={() => {}}
      />
    </ShellContext>,
  );
}

describe("ConsolePanel logs", () => {
  test("renders the complete accessible control surface", () => {
    const html = renderConsole("logs", "/logs?device=D&amp;token=T");

    expect(html).toContain("Logs");
    expect(html).toContain("Web Inspector");
    expect(html).toContain('aria-label="Search logs"');
    expect(html).toContain('aria-label="Capture level"');
    expect(html).toContain('aria-label="Filter by process"');
    expect(html).toContain('aria-label="Include system logs"');
    expect(html).toContain('aria-pressed="false" aria-label="Include system logs"');
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Clear"');
    expect(html).toContain('aria-label="Close console"');
    expect(html).toContain('role="log"');
    expect(html).toContain("Connecting");
    expect(html).toContain("Waiting for simulator logs…");
  });

  test("reports an unavailable stream and disables pause", () => {
    const html = renderConsole("logs", undefined);
    expect(html).toContain("Unavailable");
    expect(html).toMatch(/aria-label="Pause"[^>]*disabled/);
  });
});

describe("ConsolePanel accessibility", () => {
  test("waits for data and exposes the overlay switch", () => {
    const html = renderConsole("accessibility", undefined);
    expect(html).toContain("Waiting for accessibility data…");
    expect(html).toContain('role="switch"');
    expect(html).toContain("Show overlay");
  });
});

describe("ConsolePanel web inspector", () => {
  test("explains how to get a target when there are none", () => {
    const html = renderConsole("web", undefined);
    expect(html).toContain("No inspectable Safari or WKWebView targets");
    expect(html).toContain("Open Safari or an inspectable WKWebView in the simulator.");
  });
});

describe("SimLogRows", () => {
  test("escapes hostile messages and renders source metadata without HTML injection", () => {
    const entry: SimLogEntry = {
      id: "1",
      timestamp: "2026-07-11 09:41:00.123456+0800",
      process: "ExampleApp",
      processId: 4242,
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
    expect(html).toContain('data-log-level="error"');
    expect(html).toContain("09:41:00.123456");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("owned")</script>');
  });
});
