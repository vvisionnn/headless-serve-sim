import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceViewTool } from "../client/components/device-view-tool";

test("exposes bezel, scale, keyboard and animation controls", () => {
  const html = renderToStaticMarkup(
    <DeviceViewTool
      bezels
      scale={1}
      slowAnimations={false}
      onBezelsChange={() => {}}
      onScaleChange={() => {}}
      onSlowAnimationsChange={() => {}}
      onSoftwareKeyboard={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Show bezels"');
  expect(html).toContain('aria-label="Scale"');
  expect(html).toContain("Scale is capped to keep the whole device visible.");
  expect(html).toContain('aria-label="Slow animations"');
  expect(html).toContain("Software keyboard");
});

test("exposes explicit browser keyboard capture without taking form input", () => {
  const html = renderToStaticMarkup(
    <DeviceViewTool
      bezels
      scale={1}
      slowAnimations={false}
      keyboardCapture={false}
      onKeyboardCaptureChange={() => {}}
      onBezelsChange={() => {}}
      onScaleChange={() => {}}
      onSlowAnimationsChange={() => {}}
      onSoftwareKeyboard={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Capture keyboard"');
  expect(html).toContain("Form fields remain editable");
});
