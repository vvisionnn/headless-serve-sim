import { describe, expect, test } from "bun:test";
import { parseDocumentArgs } from "../document-import";

describe("parseDocumentArgs", () => {
  test("import with a single file", () => {
    expect(parseDocumentArgs(["import", "/tmp/a.pdf"])).toEqual({
      verb: "import",
      files: ["/tmp/a.pdf"],
      device: undefined,
      into: undefined,
      name: undefined,
      quiet: false,
    });
  });

  test("import with multiple files", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "b.epub", "c.txt"]),
    ).toMatchObject({ verb: "import", files: ["a.pdf", "b.epub", "c.txt"] });
  });

  test("-d device flag is captured", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "-d", "iPad Pro"]),
    ).toMatchObject({ device: "iPad Pro", files: ["a.pdf"] });
  });

  test("--device long form is captured", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "--device", "UDID-1"]),
    ).toMatchObject({ device: "UDID-1" });
  });

  test("--into subfolder is captured and normalized", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "--into", "Books/"])).toMatchObject({
      into: "Books",
    });
    expect(parseDocumentArgs(["import", "a.pdf", "--into=Reports/2024/"])).toMatchObject({
      into: "Reports/2024",
    });
  });

  test("--name overrides the destination filename for a single file", () => {
    expect(
      parseDocumentArgs(["import", "/tmp/headless-serve-sim-doc-xyz.pdf", "--name", "report.pdf"]),
    ).toMatchObject({ files: ["/tmp/headless-serve-sim-doc-xyz.pdf"], name: "report.pdf" });
  });

  test("-q/--quiet sets the quiet flag", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "-q"])).toMatchObject({ quiet: true });
    expect(parseDocumentArgs(["import", "a.pdf", "--quiet"])).toMatchObject({ quiet: true });
  });

  test("missing subcommand is an error", () => {
    expect(parseDocumentArgs([])).toEqual({
      error: expect.stringContaining("Missing subcommand"),
    });
  });

  test("unknown subcommand is an error", () => {
    expect(parseDocumentArgs(["export", "a.pdf"])).toEqual({
      error: expect.stringContaining("Unknown subcommand"),
    });
  });

  test("import with no files is an error", () => {
    expect(parseDocumentArgs(["import"])).toEqual({
      error: expect.stringContaining("Missing file"),
    });
  });

  test("--name with multiple files is rejected", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "b.pdf", "--name", "x.pdf"]),
    ).toEqual({ error: expect.stringContaining("single file") });
  });

  test("--name with a path separator is rejected", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "--name", "sub/x.pdf"]),
    ).toEqual({ error: expect.stringContaining("Invalid --name") });
  });

  test("--into with a parent-dir segment is rejected (path traversal)", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "--into", "../escape"]),
    ).toEqual({ error: expect.stringContaining("Invalid --into") });
  });

  test("--into with an absolute path is rejected", () => {
    expect(
      parseDocumentArgs(["import", "a.pdf", "--into", "/etc"]),
    ).toEqual({ error: expect.stringContaining("Invalid --into") });
  });

  test("missing value for -d is an error", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "-d"])).toEqual({
      error: expect.stringContaining("Missing value for -d"),
    });
  });

  test("unknown flag is rejected", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "--bogus"])).toEqual({
      error: expect.stringContaining("Unknown flag"),
    });
  });
});
