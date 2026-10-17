import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreenshotTool, pngSize, screenshotMeta } from "../client/components/screenshot-tool";

// A 1206×2622 PNG header: signature, IHDR length + type, width, height, depth…
const header = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x04,
  0xb6, 0, 0, 0x0a, 0x3e, 8, 6, 0, 0, 0,
]).toString("base64");

describe("screenshot capture meta", () => {
  test("reads pixel size from the PNG header", () => {
    expect(pngSize(header)).toEqual({ width: 1206, height: 2622 });
    expect(screenshotMeta(header)).toBe("1206 × 2622 · PNG");
  });

  test("falls back to the format alone for non-PNG bytes", () => {
    expect(pngSize(Buffer.from("not a png at all, really not").toString("base64"))).toBeNull();
    expect(screenshotMeta("")).toBe("PNG");
  });
});

describe("ScreenshotTool", () => {
  test("offers display and mask options and a ⌘S capture button", () => {
    const html = renderToStaticMarkup(<ScreenshotTool udid="DEVICE-1" />);
    for (const text of [
      "Screenshot",
      'aria-label="Display"',
      'aria-label="Mask"',
      "Internal",
      "Alpha",
      "Take screenshot",
      "⌘",
    ]) {
      expect(html).toContain(text);
    }
  });

  test("names foldable displays by panel", () => {
    const html = renderToStaticMarkup(<ScreenshotTool udid="DEVICE-1" foldable />);
    expect(html).toContain("Cover");
    expect(html).toContain("Inner");
    expect(html).not.toContain("External");
  });
});
