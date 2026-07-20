import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulatorDisconnected } from "../client/components/simulator-disconnected";

// The panel shown when the user-selected simulator disconnects. It must never
// offer automatic selection; changing devices requires the explicit picker.
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

  test("never offers auto-connect", () => {
    const html = renderToStaticMarkup(
      <SimulatorDisconnected deviceName="iPhone 16 Pro" onChooseAnother={() => {}} />,
    ).toLowerCase();
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("auto-connect");
  });
});
