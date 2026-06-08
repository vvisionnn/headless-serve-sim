import { describe, expect, test } from "bun:test";
import { parseScreenshotArgs } from "../screenshot";

describe("parseScreenshotArgs", () => {
  test("no args defaults to png with no path and no timestamp", () => {
    expect(parseScreenshotArgs([])).toEqual({
      path: undefined,
      type: "png",
      display: undefined,
      mask: undefined,
      device: undefined,
      quiet: false,
    });
  });

  test("a single positional is taken as the output path", () => {
    expect(parseScreenshotArgs(["/tmp/a.png"])).toMatchObject({ path: "/tmp/a.png" });
  });

  test("--type accepts the space and = forms", () => {
    expect(parseScreenshotArgs(["--type", "jpeg"])).toMatchObject({ type: "jpeg" });
    expect(parseScreenshotArgs(["--type=tiff"])).toMatchObject({ type: "tiff" });
  });

  test("--type bmp is accepted", () => {
    expect(parseScreenshotArgs(["--type", "bmp"])).toMatchObject({ type: "bmp" });
  });

  test("--type rejects an unknown value with the allowed list", () => {
    const r = parseScreenshotArgs(["--type", "bogus"]);
    expect(r).toEqual({ error: expect.stringContaining("Invalid --type") });
    expect((r as { error: string }).error).toContain("png, jpeg, tiff, bmp");
  });

  test("--display accepts internal and external (space and = forms)", () => {
    expect(parseScreenshotArgs(["--display", "internal"])).toMatchObject({ display: "internal" });
    expect(parseScreenshotArgs(["--display=external"])).toMatchObject({ display: "external" });
  });

  test("--display rejects an unknown value", () => {
    expect(parseScreenshotArgs(["--display", "bogus"])).toEqual({
      error: expect.stringContaining("Invalid --display"),
    });
  });

  test("--mask accepts ignored, alpha, and black (space and = forms)", () => {
    expect(parseScreenshotArgs(["--mask", "alpha"])).toMatchObject({ mask: "alpha" });
    expect(parseScreenshotArgs(["--mask=black"])).toMatchObject({ mask: "black" });
    expect(parseScreenshotArgs(["--mask", "ignored"])).toMatchObject({ mask: "ignored" });
  });

  test("--mask rejects an unknown value", () => {
    expect(parseScreenshotArgs(["--mask", "bogus"])).toEqual({
      error: expect.stringContaining("Invalid --mask"),
    });
  });

  test("-d and --device are captured", () => {
    expect(parseScreenshotArgs(["-d", "UDID-1"])).toMatchObject({ device: "UDID-1" });
    expect(parseScreenshotArgs(["--device", "iPhone 15"])).toMatchObject({ device: "iPhone 15" });
  });

  test("missing value for --type is an error", () => {
    expect(parseScreenshotArgs(["--type"])).toEqual({
      error: expect.stringContaining("Missing value for --type"),
    });
  });

  test("missing value for -d is an error", () => {
    expect(parseScreenshotArgs(["-d"])).toEqual({
      error: expect.stringContaining("Missing value for -d"),
    });
  });

  test("an unknown flag is rejected", () => {
    expect(parseScreenshotArgs(["--bogus"])).toEqual({
      error: expect.stringContaining("Unknown flag"),
    });
  });

  test("a second positional is rejected", () => {
    expect(parseScreenshotArgs(["a.png", "b.png"])).toEqual({
      error: expect.stringContaining("Unexpected argument"),
    });
  });

  test("-q/--quiet sets the quiet flag (alone and with a path)", () => {
    expect(parseScreenshotArgs(["-q"])).toMatchObject({ quiet: true });
    expect(parseScreenshotArgs(["--quiet"])).toMatchObject({ quiet: true });
    expect(parseScreenshotArgs(["/tmp/a.png", "-q"])).toMatchObject({
      path: "/tmp/a.png",
      quiet: true,
    });
  });

  test("path plus every flag together is the full happy path", () => {
    expect(
      parseScreenshotArgs([
        "/tmp/shot.png",
        "--type",
        "png",
        "--display",
        "internal",
        "--mask",
        "alpha",
        "-d",
        "UDID-1",
      ]),
    ).toMatchObject({
      path: "/tmp/shot.png",
      type: "png",
      display: "internal",
      mask: "alpha",
      device: "UDID-1",
    });
  });
});
