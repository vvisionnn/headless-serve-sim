import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AxSnapshot } from "../ax-shared";
import { AxDomOverlay } from "../client/components/ax-dom-overlay";
import { AxSelectionContext, AxSnapshotContext } from "../client/hooks/use-ax-snapshot";

function render(snapshot: AxSnapshot | null) {
  return renderToStaticMarkup(
    <AxSnapshotContext value={{ snapshot, status: snapshot ? "1 AX elements" : "AX waiting" }}>
      <AxSelectionContext
        value={{
          highlightedKey: null,
          selectedKey: null,
          setHighlightedKey: () => {},
          setSelectedKey: () => {},
        }}
      >
        <AxDomOverlay interfaceOrientation="portrait" displayOrientation="portrait" />
      </AxSelectionContext>
    </AxSnapshotContext>,
  );
}

test("the overlay answers at once while the first walk runs", () => {
  expect(render(null)).toContain("data-ax-scanning");
});

test("once the walk lands the scan gives way to the elements", () => {
  const html = render({
    screen: { width: 420, height: 912 },
    elements: [
      {
        id: "e",
        path: "0.0",
        label: "Settings",
        value: "",
        role: "",
        type: "Heading",
        enabled: true,
        frame: { x: 20, y: 126, width: 133, height: 41 },
      },
    ],
  });
  expect(html).not.toContain("data-ax-scanning");
  expect(html).toContain("Settings");
});
