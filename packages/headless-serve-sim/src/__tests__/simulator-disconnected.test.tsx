import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulatorDisconnected } from "../client/components/simulator-disconnected";

// The panel shown when auto-connect is OFF and the pinned simulator disconnects.
// It must never re-target a different simulator, and — per product — must not use
// the word "reconnecting".
describe("SimulatorDisconnected", () => {
  test("names the disconnected simulator", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected deviceName="iPhone 16 Pro" onChooseAnother={() => {}} />,
    );
    expect(html).toContain("iPhone 16 Pro");
  });

  test("never says 'reconnect' / 'reconnecting'", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected deviceName="iPhone 16 Pro" onChooseAnother={() => {}} />,
    ).toLowerCase();
    expect(html).not.toContain("reconnect");
  });

  test("offers an explicit escape to another simulator", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected deviceName="iPhone 16 Pro" onChooseAnother={() => {}} />,
    );
    expect(html).toContain("Choose another simulator");
  });

  test("falls back to a generic label when the name is unknown", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected deviceName={null} onChooseAnother={() => {}} />,
    );
    expect(html).toContain("This simulator disconnected");
  });

  test("does not offer the auto-connect switch by default", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected deviceName="iPhone 16 Pro" onChooseAnother={() => {}} />,
    );
    expect(html).not.toContain('role="switch"');
  });

  test("offers the auto-connect switch when enabling it would actually hop", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected
        deviceName="iPhone 16 Pro"
        onChooseAnother={() => {}}
        canAutoConnect
        autoConnect={false}
        onAutoConnectChange={() => {}}
      />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html.toLowerCase()).toContain("auto-connect");
  });

  test("hides the switch for a URL-pinned session where enabling it is a no-op", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected
        deviceName="iPhone 16 Pro"
        onChooseAnother={() => {}}
        canAutoConnect={false}
        onAutoConnectChange={() => {}}
      />,
    );
    expect(html).not.toContain('role="switch"');
  });
});
