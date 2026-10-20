import { describe, expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { DeviceBezel, preloadScreenMasks, screenLook } from "../client/components/device-bezel";
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

test("a hidden bezel stays mounted around the bare screen so it can fade", () => {
  const geometry = fitDeviceBezel({
    spec,
    rotation: 0,
    availWidth: 1000,
    availHeight: 1000,
    maxScreenWidth: 1000,
    maxScale: 1,
  });
  // As the stage passes it: the bare screen, twice the framed one's size.
  const bare = {
    ...geometry,
    screen: {
      ...geometry.screen,
      width: geometry.screen.width * 2,
      height: geometry.screen.height * 2,
    },
  };
  const html = renderToStaticMarkup(
    <DeviceBezel spec={spec} geometry={bare} showFrame={false}>
      <span>stream</span>
    </DeviceBezel>,
  );
  const layer = html.match(/<div data-bezel-layer=""[^>]*style="([^"]*)"/)?.[1];
  expect(layer).toContain("opacity:0");
  // Scaled about the screen's corner so its hole lands on the bare screen.
  expect(layer).toContain(
    `transform:translate(${-geometry.screen.x * 2}px, ${-geometry.screen.y * 2}px) scale(2)`,
  );
  expect(html).toMatch(/<div data-bezel-layer=""[^>]*inert/);
});

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

test("every turn's screen mask is decoded before the device turns", () => {
  const loaded: string[] = [];
  const original = (globalThis as { Image?: unknown }).Image;
  (globalThis as { Image?: unknown }).Image = class {
    set src(url: string) {
      loaded.push(url);
    }
    decode() {
      return Promise.resolve();
    }
  };
  try {
    preloadScreenMasks(spec);
    preloadScreenMasks(spec);
    // Four orientations, once each, whatever the device does next.
    expect(loaded).toHaveLength(4);
    expect(new Set(loaded).size).toBe(4);
    expect(loaded[0]).toBe(spec.screenMask!.pngDataUrl);
  } finally {
    (globalThis as { Image?: unknown }).Image = original;
  }
});

describe("screenLook", () => {
  test("bare, the screen is rounded at once", () => {
    for (const masked of [false, true])
      for (const fading of [false, true])
        expect(screenLook({ showFrame: false, fading, masked })).toEqual({
          radius: "bare",
          mask: false,
          transition: false,
        });
  });

  test("while the bezel fades in, the corners ease to the profile's radii with no mask yet", () => {
    for (const masked of [false, true])
      expect(screenLook({ showFrame: true, fading: true, masked })).toEqual({
        radius: "frame",
        mask: false,
        transition: true,
      });
  });

  test("once framed, a masked screen uses only its exact mask", () => {
    expect(screenLook({ showFrame: true, fading: false, masked: true })).toEqual({
      radius: "none",
      mask: true,
      transition: false,
    });
    expect(screenLook({ showFrame: true, fading: false, masked: false })).toEqual({
      radius: "frame",
      mask: false,
      transition: false,
    });
  });
});

test("the bare screen's shadow is its own layer, crossfading with the bezel", () => {
  const geometry = fitDeviceBezel({
    spec,
    rotation: 0,
    availWidth: 1000,
    availHeight: 1000,
    maxScreenWidth: 1000,
    maxScale: 1,
  });
  const shadow = (showFrame: boolean) =>
    renderToStaticMarkup(
      <DeviceBezel spec={spec} geometry={geometry} showFrame={showFrame}>
        <span>stream</span>
      </DeviceBezel>,
    ).match(/<div aria-hidden="true" data-screen-shadow=""[^>]*style="([^"]*)"/)?.[1];
  // The same 0.3s curve as the bezel layer's opacity, so one rises as the
  // other falls and no frame shows the screen with neither.
  expect(shadow(true)).toContain("opacity:0");
  expect(shadow(false)).toContain("opacity:1");
  expect(shadow(true)).toContain("filter:var(--device-shadow)");
  expect(shadow(true)).toContain("opacity 0.3s var(--ease-out-quint)");
});
