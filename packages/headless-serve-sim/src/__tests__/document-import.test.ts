import { describe, expect, test } from "bun:test";
import {
  createDocumentImporter,
  parseDocumentArgs,
  type DocumentFileSystem,
} from "../document-import";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

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
    expect(parseDocumentArgs(["import", "a.pdf", "b.epub", "c.txt"])).toMatchObject({
      verb: "import",
      files: ["a.pdf", "b.epub", "c.txt"],
    });
  });

  test("-d device flag is captured", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "-d", "iPad Pro"])).toMatchObject({
      device: "iPad Pro",
      files: ["a.pdf"],
    });
  });

  test("--device long form is captured", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "--device", "UDID-1"])).toMatchObject({
      device: "UDID-1",
    });
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
    expect(parseDocumentArgs(["import", "a.pdf", "b.pdf", "--name", "x.pdf"])).toEqual({
      error: expect.stringContaining("single file"),
    });
  });

  test("--name with a path separator is rejected", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "--name", "sub/x.pdf"])).toEqual({
      error: expect.stringContaining("Invalid --name"),
    });
  });

  test("--into with a parent-dir segment is rejected (path traversal)", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "--into", "../escape"])).toEqual({
      error: expect.stringContaining("Invalid --into"),
    });
  });

  test("--into with an absolute path is rejected", () => {
    expect(parseDocumentArgs(["import", "a.pdf", "--into", "/etc"])).toEqual({
      error: expect.stringContaining("Invalid --into"),
    });
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

describe("document importer module", () => {
  test("resolves Files storage and copies a renamed document through injected adapters", () => {
    const host = createScriptedHostCommands([
      {
        result: {
          stdout: "group.com.apple.FileProvider.LocalStorage\t/containers/local\n",
        },
      },
    ]);
    const made: string[] = [];
    const copied: Array<[string, string]> = [];
    const resolveCalls: unknown[][] = [];
    const files: DocumentFileSystem = {
      exists: (path) => path === "/input/report.pdf",
      list: () => [],
      makeDirectory: (path) => {
        made.push(path);
      },
      copy: (source, destination) => {
        copied.push([source, destination]);
      },
      homeDirectory: () => "/home/test",
      resolvePath: (...paths) => {
        resolveCalls.push(paths);
        return paths[0] as string;
      },
    };

    const imported = createDocumentImporter(host, files).importFiles("DEVICE", {
      verb: "import",
      files: ["/input/report.pdf"],
      into: "Books",
      name: "renamed.pdf",
      quiet: false,
    });

    expect(imported).toEqual([
      { name: "renamed.pdf", path: "/containers/local/File Provider Storage/Books/renamed.pdf" },
    ]);
    expect(made).toEqual(["/containers/local/File Provider Storage/Books"]);
    expect(copied).toEqual([
      ["/input/report.pdf", "/containers/local/File Provider Storage/Books/renamed.pdf"],
    ]);
    expect(resolveCalls).toEqual([["/input/report.pdf"]]);
    expect(host.calls).toEqual([
      {
        kind: "run-sync",
        request: {
          executable: "xcrun",
          args: ["simctl", "get_app_container", "DEVICE", "com.apple.DocumentsApp", "groups"],
          stdio: "capture",
        },
      },
    ]);
  });

  test("rejects missing source files before storage discovery", () => {
    const host = createScriptedHostCommands();
    const files: DocumentFileSystem = {
      exists: () => false,
      list: () => [],
      makeDirectory: () => {},
      copy: () => {},
      homeDirectory: () => "/home/test",
      resolvePath: (path) => path,
    };

    expect(() =>
      createDocumentImporter(host, files).importFiles("DEVICE", {
        verb: "import",
        files: ["/missing.pdf"],
        quiet: false,
      }),
    ).toThrow("File(s) not found");
    expect(host.calls).toEqual([]);
  });

  test("falls back to app-group metadata when simulator container lookup fails", () => {
    const host = createScriptedHostCommands([
      { result: { exitCode: 1 } },
      { result: { stdout: "<string>group.com.apple.FileProvider.LocalStorage</string>" } },
    ]);
    const groups =
      "/home/test/Library/Developer/CoreSimulator/Devices/DEVICE/data/Containers/Shared/AppGroup";
    const metadata = `${groups}/GROUP-ID/.com.apple.mobile_container_manager.metadata.plist`;
    const files: DocumentFileSystem = {
      exists: (path) => path === groups || path === metadata,
      list: () => ["GROUP-ID"],
      makeDirectory: () => {},
      copy: () => {},
      homeDirectory: () => "/home/test",
      resolvePath: (path) => path,
    };

    expect(createDocumentImporter(host, files).localStorageDir("DEVICE")).toBe(
      `${groups}/GROUP-ID/File Provider Storage`,
    );
    expect(host.calls[1]?.request).toEqual({
      executable: "plutil",
      args: ["-convert", "xml1", "-o", "-", metadata],
      stdio: "capture",
    });
  });
});
