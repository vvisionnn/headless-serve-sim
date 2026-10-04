import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { DeviceBezel } from "../client/components/device-bezel";
import { fitDeviceBezel } from "../client/utils/bezel-geometry";

const spec: DeviceFrameSpec = {
  deviceTypeIdentifier: "type.iphone-duo",
  modelName: "iPhone Duo",
  family: "iphone",
  nativeScreen: { width: 1398, height: 2034 },
  insetsPx: { top: 42, right: 66, bottom: 42, left: 78 },
  screenRadiiPx: { topLeft: 24, topRight: 177, bottomRight: 177, bottomLeft: 24 },
  outerRadiiPx: { x: 240, y: 240 },
  cutout: "none",
  chromeIdentifier: "phone15",
  screenMask: { pngDataUrl: "data:image/png;base64,c2NyZWVu", width: 1398, height: 2034 },
};

test("bezel visibility preserves the stream child at the same keyed ancestor", () => {
  const spies = [
    spyOn(React, "useState").mockReturnValue([null, () => {}]),
    spyOn(React, "useEffect").mockImplementation(() => {}),
  ];
  try {
    const geometry = fitDeviceBezel({
      spec,
      rotation: 0,
      availWidth: 1000,
      availHeight: 1000,
      maxScreenWidth: 1000,
      maxScale: 1,
    });
    const child = <span>stream</span>;
    const withFrame = DeviceBezel({ spec, geometry, children: child, showFrame: true });
    const withoutFrame = DeviceBezel({ spec, geometry, children: child, showFrame: false });
    const screen = (
      element: React.ReactElement<{
        children: React.ReactElement<{ children: React.ReactNode }>[];
      }>,
    ) => {
      const children = element.props.children;
      return children.find((node) => node?.key === "screen")!;
    };
    expect(screen(withFrame)).toBeDefined();
    expect(screen(withFrame).type).toBe(screen(withoutFrame).type);
    expect(screen(withFrame).props.children).toBe(child);
    expect(screen(withoutFrame).props.children).toBe(child);
    expect(withoutFrame.props.style).toEqual({
      width: geometry.screen.width,
      height: geometry.screen.height,
    });
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
});

function render(rotation: number, frame = spec) {
  const geometry = fitDeviceBezel({
    spec: frame,
    rotation,
    availWidth: 10_000,
    availHeight: 10_000,
    maxScreenWidth: 10_000,
    maxScale: 1,
  });
  return renderToStaticMarkup(
    <DeviceBezel spec={frame} geometry={geometry}>
      <span>stream</span>
    </DeviceBezel>,
  );
}

test("keeps ordinary unmasked phones clipped to their rotated profile radii", () => {
  const frame = { ...spec, screenMask: undefined };
  const geometry = fitDeviceBezel({
    spec: frame,
    rotation: 90,
    availWidth: 10_000,
    availHeight: 10_000,
    maxScreenWidth: 10_000,
    maxScale: 1,
  });
  const html = render(90, frame);
  const radii = geometry.screenRadii;
  expect(html).toContain(
    `border-radius:${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`,
  );
  expect(html).not.toContain("mask-image:");
});

test("uses exact alpha masks without also cutting them with approximate circular radii", () => {
  const html = render(0);
  expect(html).toContain(`mask-image:url(${spec.screenMask!.pngDataUrl})`);
  expect(html).toContain("mask-mode:alpha");
  const screenStyle = html.match(/class="absolute overflow-hidden bg-black" style="([^"]*)"/)?.[1];
  expect(screenStyle).not.toContain("border-radius:");
});

test("rotates the canonical screen mask into each oriented screen rectangle", () => {
  for (const rotation of [90, -90, 180, -180]) {
    const html = render(rotation);
    const maskUrl = html.match(/mask-image:url\(([^)]+)\)/)?.[1];
    expect(maskUrl).toStartWith("data:image/svg+xml,");
    const svg = decodeURIComponent(maskUrl!.slice("data:image/svg+xml,".length));
    const sideways = Math.abs(rotation) === 90;
    const width = sideways ? 2034 : 1398;
    const height = sideways ? 1398 : 2034;
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(svg).toContain(
      `translate(${width / 2} ${height / 2}) rotate(${rotation}) translate(-699 -1017)`,
    );
    expect(svg).toContain('width="1398" height="2034"');
    expect(svg).toContain(spec.screenMask!.pngDataUrl);
  }
});
