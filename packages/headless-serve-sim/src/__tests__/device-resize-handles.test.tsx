import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceResizeHandles } from "../client/components/device-resize-handles";

test("renders only three visible grabber drag targets outside the live screen", () => {
  const markup = renderToStaticMarkup(
    <DeviceResizeHandles
      fittedSize={{ width: 300, height: 600 }}
      availableSize={{ width: 600, height: 900 }}
      scale={0.8}
      onScaleChange={() => {}}
    />,
  );
  expect(markup.match(/data-device-resize-handle=/g)).toHaveLength(3);
  for (const handle of ["e", "s", "w"]) {
    expect(markup).toContain(`data-device-resize-handle="${handle}"`);
  }
  expect(markup).toContain("pointer-events-none");
  expect(markup.match(/pointer-events-auto/g)).toHaveLength(3);
  expect(markup.match(/touch-none/g)).toHaveLength(3);
  expect(markup.match(/ns-resize/g)).toHaveLength(1);
  expect(markup.match(/ew-resize/g)).toHaveLength(2);
  expect(markup).not.toContain("nesw-resize");
  expect(markup).not.toContain("nwse-resize");
});

test("provides hover grabbers outside the left, right and bottom bezel edges", () => {
  const markup = renderToStaticMarkup(
    <DeviceResizeHandles
      fittedSize={{ width: 300, height: 600 }}
      availableSize={{ width: 600, height: 900 }}
      scale={1}
      onScaleChange={() => {}}
    />,
  );
  expect(markup.match(/data-device-resize-grabber=/g)).toHaveLength(3);
  for (const handle of ["w", "e", "s"]) {
    expect(markup).toContain(`data-device-resize-grabber="${handle}"`);
  }
  expect(markup).toContain("device-resize-grabber");
  expect(markup).toContain("-left-3");
  expect(markup).toContain("-right-3");
  expect(markup).toContain("-bottom-3");
});

test("positions hits at projected device bounds while leaving its canvas size unchanged", () => {
  const markup = renderToStaticMarkup(
    <DeviceResizeHandles
      fittedSize={{ width: 300, height: 600 }}
      availableSize={{ width: 800, height: 900 }}
      frameRect={{ x: 120, y: 80, width: 240, height: 480 }}
      scale={0.8}
      onScaleChange={() => {}}
    />,
  );
  expect(markup).toContain("left:120px");
  expect(markup).toContain("top:80px");
  expect(markup).toContain("width:240px");
  expect(markup).toContain("height:480px");
  expect(markup.match(/data-device-resize-handle=/g)).toHaveLength(3);
});
