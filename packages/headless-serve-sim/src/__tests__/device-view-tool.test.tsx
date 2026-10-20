import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceViewTool, scaleLabel } from "../client/components/device-view-tool";

test("exposes bezel, scale, keyboard and animation controls", () => {
  const html = renderToStaticMarkup(
    <DeviceViewTool
      bezels
      scale={1}
      slowAnimations={false}
      onBezelsChange={() => {}}
      onScaleChange={() => {}}
      onRealSize={() => {}}
      onSlowAnimationsChange={() => {}}
      onSoftwareKeyboard={() => {}}
    />,
  );
  expect(html).toContain('role="switch" aria-checked="true" aria-label="Show bezel"');
  expect(html).toContain('role="slider" aria-label="Scale" aria-valuemin="0.25" aria-valuemax="1"');
  expect(html).toContain("Zoom to fit");
  expect(html).toContain("Real size");
  expect(html).toContain("Opens at its real size, with room around it.");
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

test("scale reads as a whole percentage", () => {
  expect(scaleLabel(1)).toBe("100%");
  expect(scaleLabel(0.55)).toBe("55%");
  expect(scaleLabel(1.999)).toBe("200%");
});
