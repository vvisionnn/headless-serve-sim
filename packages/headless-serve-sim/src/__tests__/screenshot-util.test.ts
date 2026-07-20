import { describe, expect, test } from "bun:test";
import { b64ToBlob, screenshotFilename } from "../client/utils/screenshot";

describe("screenshotFilename", () => {
  test("formats as simulator-YYYYMMDD-HHMMSS.png with zero-padding", () => {
    // Local time; month is 0-indexed (5 = June) and every field needs padding.
    expect(screenshotFilename(new Date(2026, 5, 1, 9, 3, 2))).toBe("simulator-20260601-090302.png");
  });

  test("does not pad already two-digit fields", () => {
    expect(screenshotFilename(new Date(2026, 11, 31, 23, 59, 59))).toBe(
      "simulator-20261231-235959.png",
    );
  });

  test("distinct seconds produce distinct names (no rapid-press collisions)", () => {
    const a = screenshotFilename(new Date(2026, 5, 11, 15, 30, 12));
    const b = screenshotFilename(new Date(2026, 5, 11, 15, 30, 13));
    expect(a).not.toBe(b);
  });
});

describe("b64ToBlob", () => {
  test("decodes base64 to a Blob with the given MIME and byte length", () => {
    const blob = b64ToBlob(btoa("hi"), "image/png");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(2);
  });
});
