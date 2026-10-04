import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceMotionTool } from "../client/components/device-motion-tool";

test("fold controls are disabled until a simulator is streaming", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool
      disabled
      angle={130}
      pose="book"
      onAngleChange={() => {}}
      onPoseChange={() => {}}
    />,
  );
  expect(html.match(/disabled=""/g)).toHaveLength(4);
});

test("exposes native Duo presets and continuous opening angle", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool angle={130} pose="book" onAngleChange={() => {}} onPoseChange={() => {}} />,
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
