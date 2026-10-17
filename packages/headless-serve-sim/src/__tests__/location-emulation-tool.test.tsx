import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationEmulationTool } from "../client/location-emulation-tool";
import { DEFAULT_TRAILS } from "../client/trails";

const exec = async () => ({ stdout: "", stderr: "", exitCode: 0 });

test("folds to a header that shows the route length", () => {
  const html = renderToStaticMarkup(<LocationEmulationTool udid="U" exec={exec} />);
  expect(html).toContain(">Location<");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain(" total");
  expect(html).not.toContain("<canvas");
});

test("opens onto the trail picker, live map, stats and transport", () => {
  const html = renderToStaticMarkup(<LocationEmulationTool udid="U" exec={exec} defaultOpen />);
  expect(html).toContain('aria-label="Trail"');
  expect(html).toContain(DEFAULT_TRAILS[0]!.name);
  expect(html).toContain("<canvas");
  for (const stat of ["Distance", "Pace", "Elapsed"]) expect(html).toContain(stat);
  expect(html).toContain('role="radiogroup" aria-label="Transport mode"');
  expect(html).toContain('aria-label="Speed 1× — tap to cycle"');
  expect(html).toContain("Play route");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(<[^>]*>)*Stop/);
});
