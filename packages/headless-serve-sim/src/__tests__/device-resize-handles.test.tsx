import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceResizeHandles } from "../client/components/device-resize-handles";

test("rotation bounds do not tear down the active grabber drag", () => {
  const hooks: { current: unknown }[] = [];
  const deps: React.DependencyList[] = [];
  let hook = 0;
  const refs = spyOn(React, "useRef").mockImplementation((value) => {
    const index = hook++;
    return hooks[index] ?? (hooks[index] = { current: value });
  });
  const effects = spyOn(React, "useEffect").mockImplementation((_effect, dependencies) => {
    deps.push(dependencies ?? []);
  });
  try {
    const props = {
      fittedSize: { width: 620, height: 443 },
      availableSize: { width: 1400, height: 800 },
      scale: 1.2,
      onScaleChange() {},
    };
    DeviceResizeHandles(props);
    const initial = deps.splice(0);
    hook = 0;
    DeviceResizeHandles({ ...props, fittedSize: { width: 443, height: 620 } });
    expect(deps).toEqual(initial);
  } finally {
    refs.mockRestore();
    effects.mockRestore();
  }
});

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
