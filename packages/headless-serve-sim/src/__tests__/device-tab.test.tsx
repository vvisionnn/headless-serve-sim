import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceTab } from "../client/inspector/device-tab";
import type { InspectorProps } from "../client/inspector/types";

function props(foldable: boolean): InspectorProps {
  const noop = () => {};
  return {
    udid: "U",
    uiSettingsRevision: 0,
    currentApp: null,
    foldable,
    view: {
      bezels: true,
      scale: 1,
      slowAnimations: false,
      onBezelsChange: noop,
      onScaleChange: noop,
      onSlowAnimationsChange: noop,
      onSoftwareKeyboard: noop,
    },
    onOrientationChange: noop,
  } as unknown as InspectorProps;
}

function order(html: string, markers: string[]) {
  return markers.map((m) => html.indexOf(m));
}

test("lays out settings, then view, then the folded tools in design order", () => {
  const html = renderToStaticMarkup(<DeviceTab {...props(false)} />);
  const at = order(html, [
    ">Appearance</h3>",
    ">Accessibility</h3>",
    ">View</h3>",
    ">Status bar<",
    ">Location<",
    ">Camera<",
  ]);
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(html).not.toContain(">Sound<");
});

test("adds the Duo simulator controls between View and Status bar", () => {
  const html = renderToStaticMarkup(<DeviceTab {...props(true)} />);
  const at = order(html, [">View</h3>", ">Sound<", ">Clipboard<", ">Status bar<"]);
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
});
