import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { DeviceMotionTool } from "../client/components/device-motion-tool";

test("preset buttons send their displayed angles through the slider handler", () => {
  const angles: number[] = [];
  const view = DeviceMotionTool({
    angle: 130,
    pose: "book",
    onAngleChange: (angle) => angles.push(angle),
  });
  const row = view.props.children[0];
  const options = row.props.children[0].props.children as ReactElement<{
    children: ReactElement<{ onClick(): void }>;
  }>[];
  options.forEach((option) => option.props.children.props.onClick());
  expect(angles).toEqual([0, 130, 180]);
});

test("disabled fold preset icons stay opaque", async () => {
  const css = await Bun.file(new URL("../client/global.css", import.meta.url)).text();
  expect(/\.duo-pose-button button:disabled\s*\{[^}]*opacity:\s*1/.test(css)).toBe(true);
});

test("fold controls are disabled until a simulator is streaming", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool disabled angle={130} pose="book" onAngleChange={() => {}} />,
  );
  expect(html.match(/disabled=""/g)).toHaveLength(4);
});

test("exposes native Duo presets and continuous opening angle", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool angle={130} pose="book" onAngleChange={() => {}} />,
  );
  expect(html).toContain('aria-label="Hinge angle"');
  expect(html).toContain('min="0"');
  expect(html).toContain('max="180"');
  expect(html).toContain("130°");
  expect(html).toContain("Closed");
  expect(html).toContain("Book");
  expect(html).toContain("Open");
  expect(html).toContain('aria-label="Fold controls"');
  expect(html).toContain('class="duo-hinge-slider');
  expect(html).not.toContain('class="ds-slider');
  expect(html).toContain('aria-pressed="true"');
  expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
});
