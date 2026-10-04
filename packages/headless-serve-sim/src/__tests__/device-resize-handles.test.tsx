import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceResizeHandles } from "../client/components/device-resize-handles";

test("renders eight exterior hit regions without covering the live device screen", () => {
  const markup = renderToStaticMarkup(
    <DeviceResizeHandles
      fittedSize={{ width: 300, height: 600 }}
      availableSize={{ width: 600, height: 900 }}
      scale={0.8}
      onScaleChange={() => {}}
    />,
  );
  expect(markup.match(/data-device-resize-handle=/g)).toHaveLength(8);
  for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
    expect(markup).toContain(`data-device-resize-handle="${handle}"`);
  }
  expect(markup).toContain("pointer-events-none");
  expect(markup.match(/pointer-events-auto/g)).toHaveLength(8);
  expect(markup.match(/touch-none/g)).toHaveLength(8);
  expect(markup.match(/ns-resize/g)).toHaveLength(2);
  expect(markup.match(/ew-resize/g)).toHaveLength(2);
  expect(markup.match(/nesw-resize/g)).toHaveLength(2);
  expect(markup.match(/nwse-resize/g)).toHaveLength(2);
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
  expect(markup.match(/data-device-resize-handle=/g)).toHaveLength(8);
});
