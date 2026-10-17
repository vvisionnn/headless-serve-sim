import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DUO_POSES, DeviceMotionTool } from "../client/components/device-motion-tool";

test("pose presets carry their displayed angles", () => {
  expect(DUO_POSES.map((p) => [p.label, p.angle])).toEqual([
    ["Closed", 0],
    ["Book", 130],
    ["Open", 180],
  ]);
});

test("fold controls are disabled until a simulator is streaming", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool disabled angle={130} pose="book" onAngleChange={() => {}} />,
  );
  expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
  expect(html).toContain('role="slider" aria-label="Hinge angle"');
  expect(html).toMatch(/aria-label="Hinge angle"[^>]*aria-disabled="true"/);
});

test("exposes native Duo presets and continuous opening angle", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool angle={130} pose="book" onAngleChange={() => {}} />,
  );
  expect(html).toContain('aria-label="Hinge angle"');
  expect(html).toContain('aria-valuemin="0"');
  expect(html).toContain('aria-valuemax="180"');
  expect(html).toContain('aria-valuenow="130"');
  expect(html).toContain("130°");
  expect(html).toContain('aria-label="Closed"');
  expect(html).toContain('aria-label="Book"');
  expect(html).toContain('aria-label="Open"');
  expect(html).toContain('aria-label="Fold controls"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
});

test("surfaces fold errors as an alert", () => {
  const html = renderToStaticMarkup(
    <DeviceMotionTool angle={0} pose="closed" error="hinge failed" onAngleChange={() => {}} />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("hinge failed");
});
