import { describe, expect, test } from "bun:test";
import {
  createUserDefaults,
  normalizeDefaultsPlistForJson,
  parseDefaultsArgs,
} from "../user-defaults";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

describe("parseDefaultsArgs", () => {
  test("read with a domain", () => {
    expect(parseDefaultsArgs(["read", "com.example.app"])).toEqual({
      verb: "read",
      domain: "com.example.app",
      device: undefined,
      quiet: false,
    });
  });

  test("read captures -d device", () => {
    expect(parseDefaultsArgs(["read", "com.example.app", "-d", "iPhone 15"])).toMatchObject({
      device: "iPhone 15",
      domain: "com.example.app",
    });
  });

  test("read captures --device long form", () => {
    expect(parseDefaultsArgs(["read", "com.example.app", "--device", "UDID-1"])).toMatchObject({
      device: "UDID-1",
    });
  });

  test("write full form", () => {
    expect(
      parseDefaultsArgs(["write", "com.example.app", "MyKey", "--type", "string", "hello"]),
    ).toEqual({
      verb: "write",
      domain: "com.example.app",
      key: "MyKey",
      type: "string",
      value: "hello",
      device: undefined,
      quiet: false,
    });
  });

  test("write int/float/bool types map through", () => {
    expect(
      parseDefaultsArgs(["write", "com.example.app", "K", "--type", "int", "42"]),
    ).toMatchObject({ type: "int", value: "42" });
    expect(
      parseDefaultsArgs(["write", "com.example.app", "K", "--type", "float", "3.14"]),
    ).toMatchObject({ type: "float", value: "3.14" });
    expect(
      parseDefaultsArgs(["write", "com.example.app", "K", "--type", "bool", "true"]),
    ).toMatchObject({ type: "bool", value: "true" });
  });

  test("write accepts --type=value form", () => {
    expect(
      parseDefaultsArgs(["write", "com.example.app", "K", "--type=string", "v"]),
    ).toMatchObject({ type: "string", value: "v" });
  });

  test("write keeps a value with a space", () => {
    expect(
      parseDefaultsArgs([
        "write",
        "com.example.app",
        "Greeting",
        "--type",
        "string",
        "hello world",
      ]),
    ).toMatchObject({ value: "hello world" });
  });

  // Design lock: the value is the trailing positional. A leading-`-` token is
  // parsed as a flag, so a flag-shaped "value" is rejected as an unknown flag
  // rather than captured.
  test("write rejects a flag-shaped value as an unknown flag", () => {
    expect(
      parseDefaultsArgs(["write", "com.example.app", "K", "--type", "string", "--weird"]),
    ).toEqual({ error: expect.stringContaining("Unknown flag") });
  });

  test("delete with a key", () => {
    expect(parseDefaultsArgs(["delete", "com.example.app", "MyKey"])).toEqual({
      verb: "delete",
      domain: "com.example.app",
      key: "MyKey",
      device: undefined,
      quiet: false,
    });
  });

  test("-q/--quiet is captured and stripped", () => {
    expect(parseDefaultsArgs(["read", "com.example.app", "-q"])).toMatchObject({
      quiet: true,
      domain: "com.example.app",
    });
    expect(parseDefaultsArgs(["read", "com.example.app", "--quiet"])).toMatchObject({
      quiet: true,
    });
  });

  test("missing subcommand is an error", () => {
    expect(parseDefaultsArgs([])).toEqual({
      error: expect.stringContaining("Missing subcommand"),
    });
  });

  test("unknown subcommand is an error", () => {
    expect(parseDefaultsArgs(["export", "com.example.app"])).toEqual({
      error: expect.stringContaining("Unknown subcommand"),
    });
  });

  test("read missing domain is an error", () => {
    expect(parseDefaultsArgs(["read"])).toEqual({
      error: expect.stringContaining("domain"),
    });
  });

  test("write missing key is an error", () => {
    expect(parseDefaultsArgs(["write", "com.example.app"])).toEqual({
      error: expect.stringContaining("key"),
    });
  });

  test("write missing --type is an error", () => {
    expect(parseDefaultsArgs(["write", "com.example.app", "K", "v"])).toEqual({
      error: expect.stringContaining("--type"),
    });
  });

  test("write missing value is an error", () => {
    expect(parseDefaultsArgs(["write", "com.example.app", "K", "--type", "string"])).toEqual({
      error: expect.stringContaining("value"),
    });
  });

  test("delete missing key is an error", () => {
    expect(parseDefaultsArgs(["delete", "com.example.app"])).toEqual({
      error: expect.stringContaining("key"),
    });
  });

  test("invalid --type enum is rejected and lists the allowed set", () => {
    const res = parseDefaultsArgs(["write", "com.example.app", "K", "--type", "bogus", "1"]);
    expect(res).toHaveProperty("error");
    const err = (res as { error: string }).error;
    expect(err).toContain("bogus");
    expect(err).toContain("string");
    expect(err).toContain("int");
    expect(err).toContain("float");
    expect(err).toContain("bool");
  });

  test("invalid domain (DOMAIN_RE) is rejected", () => {
    expect(parseDefaultsArgs(["read", "com.example.app/../etc"])).toEqual({
      error: expect.stringContaining("domain"),
    });
    expect(parseDefaultsArgs(["read", "com example"])).toEqual({
      error: expect.stringContaining("domain"),
    });
  });

  test("invalid key (KEY_RE) is rejected", () => {
    expect(parseDefaultsArgs(["delete", "com.example.app", "bad key"])).toEqual({
      error: expect.stringContaining("key"),
    });
  });

  test("unknown flag is rejected", () => {
    expect(parseDefaultsArgs(["read", "com.example.app", "--bogus"])).toEqual({
      error: expect.stringContaining("Unknown flag"),
    });
  });

  test("missing value for -d is an error", () => {
    expect(parseDefaultsArgs(["read", "com.example.app", "-d"])).toEqual({
      error: expect.stringContaining("Missing value for -d"),
    });
  });
});

describe("user defaults module", () => {
  test("normalizes plist date and data values before JSON conversion", () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>LastUpdated</key><date>2026-07-20T14:00:00Z</date>
  <key>Archive</key><data>YWJj\nZA==</data>
</dict></plist>`);

    expect(normalizeDefaultsPlistForJson(xml).toString()).toContain(
      "<string>2026-07-20T14:00:00Z</string>",
    );
    expect(normalizeDefaultsPlistForJson(xml).toString()).toContain("<string>YWJjZA==</string>");
  });

  test("passes normalized plist values to plutil", async () => {
    const xml = Buffer.from(
      "<plist><dict><key>Updated</key><date>2026-07-20T14:00:00Z</date></dict></plist>",
    );
    const host = createScriptedHostCommands([
      { result: { stdout: xml } },
      { result: { stdout: '{"Updated":"2026-07-20T14:00:00Z"}' } },
    ]);

    await createUserDefaults(host).execute("DEVICE", {
      verb: "read",
      domain: "com.example.app",
      quiet: false,
    });

    expect(host.calls[1]?.request.input?.toString()).toContain(
      "<string>2026-07-20T14:00:00Z</string>",
    );
  });

  test("reads exported defaults through plist conversion with byte-preserving stdin", async () => {
    const xml = Buffer.from("<plist><dict/></plist>");
    const host = createScriptedHostCommands([
      { result: { stdout: xml } },
      { result: { stdout: '{"enabled":true}\n' } },
    ]);

    await expect(
      createUserDefaults(host).execute("DEVICE", {
        verb: "read",
        domain: "com.example.app",
        quiet: false,
      }),
    ).resolves.toBe('{"enabled":true}');
    expect(host.calls.map((call) => call.request)).toEqual([
      {
        executable: "xcrun",
        args: ["simctl", "spawn", "DEVICE", "defaults", "export", "com.example.app", "-"],
        stdio: "capture",
      },
      {
        executable: "plutil",
        args: ["-convert", "json", "-o", "-", "-"],
        input: xml,
        stdio: "capture",
      },
    ]);
  });

  test.each([
    ["string", "-string", "hello world"],
    ["int", "-int", "42"],
    ["float", "-float", "3.14"],
    ["bool", "-bool", "true"],
  ] as const)("writes %s values with the native typed flag", async (type, nativeType, value) => {
    const host = createScriptedHostCommands([{}]);
    await createUserDefaults(host).execute("DEVICE", {
      verb: "write",
      domain: "com.example.app",
      key: "Setting",
      type,
      value,
      quiet: false,
    });
    expect(host.calls[0]?.request).toEqual({
      executable: "xcrun",
      args: [
        "simctl",
        "spawn",
        "DEVICE",
        "defaults",
        "write",
        "com.example.app",
        "Setting",
        nativeType,
        value,
      ],
      stdio: "capture",
    });
  });

  test("deletes one key without invoking a shell", async () => {
    const host = createScriptedHostCommands([{}]);
    await createUserDefaults(host).execute("DEVICE", {
      verb: "delete",
      domain: "com.example.app",
      key: "Setting",
      quiet: false,
    });
    expect(host.calls[0]?.request).toEqual({
      executable: "xcrun",
      args: ["simctl", "spawn", "DEVICE", "defaults", "delete", "com.example.app", "Setting"],
      stdio: "capture",
    });
  });
});
