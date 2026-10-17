import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { DisconnectedScene } from "../client/scenes/disconnected-scene";

const spec: DeviceFrameSpec = {
  deviceTypeIdentifier: "type.iphone",
  modelName: "iPhone 17 Pro",
  family: "iphone",
  nativeScreen: { width: 1206, height: 2622 },
  insetsPx: { top: 40, right: 40, bottom: 40, left: 40 },
  screenRadiiPx: { topLeft: 160, topRight: 160, bottomRight: 160, bottomLeft: 160 },
  outerRadiiPx: { x: 200, y: 200 },
  cutout: "none",
  chromeIdentifier: "phone",
};

const render = (deviceName: string | null, frameSpec: DeviceFrameSpec | null = null) =>
  renderToStaticMarkup(
    <DisconnectedScene deviceName={deviceName} frameSpec={frameSpec} onChooseAnother={() => {}} />,
  );

// Shown when the user-selected simulator disconnects. It must never offer
// automatic selection; changing devices requires the explicit picker.
describe("DisconnectedScene", () => {
  test("names the disconnected simulator", () => {
    expect(render("iPhone 16 Pro")).toContain("iPhone 16 Pro disconnected");
  });

  test("falls back to a generic label when the name is unknown", () => {
    expect(render(null)).toContain("This simulator disconnected");
  });

  test("offers an explicit escape to another simulator, and nothing else", () => {
    const html = render("iPhone 16 Pro");
    expect(html).toContain("Choose another simulator");
    expect(html.match(/<button\b/g)?.length).toBe(1);
  });

  test("waits for the same simulator; never offers auto-connect", () => {
    const html = render("iPhone 16 Pro").toLowerCase();
    expect(html).toContain("reconnecting…");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("auto-connect");
  });

  test("keeps the device on the stage when its frame is known", () => {
    const withFrame = render("iPhone 17 Pro", spec);
    const cardOnly = render("iPhone 17 Pro");
    expect(withFrame).toContain("iPhone 17 Pro disconnected");
    expect(withFrame.length).toBeGreaterThan(cardOnly.length);
    expect(withFrame).toContain("overflow-hidden bg-black");
    expect(cardOnly).not.toContain("overflow-hidden bg-black");
  });
});
