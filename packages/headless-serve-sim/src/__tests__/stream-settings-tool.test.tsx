import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamSettingsTool } from "../client/components/stream-settings-tool";

// The inspector section that hosts the auto-connect toggle. It's a pure,
// controlled switch driven by the persisted client flag.
describe("StreamSettingsTool", () => {
  test("renders an OFF switch when auto-connect is disabled", () => {
    const html = renderToStaticMarkup(
      <StreamSettingsTool autoConnect={false} onAutoConnectChange={() => {}} />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
  });

  test("reflects the ON state", () => {
    const html = renderToStaticMarkup(
      <StreamSettingsTool autoConnect={true} onAutoConnectChange={() => {}} />,
    );
    expect(html).toContain('aria-checked="true"');
  });

  test("labels the control so its purpose is unambiguous", () => {
    const html = renderToStaticMarkup(
      <StreamSettingsTool autoConnect={false} onAutoConnectChange={() => {}} />,
    );
    expect(html.toLowerCase()).toContain("auto-connect");
  });
});
