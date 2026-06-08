import { describe, expect, test } from "bun:test";
import { parseDefaultsArgs } from "../user-defaults";

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
    expect(
      parseDefaultsArgs(["read", "com.example.app", "-d", "iPhone 15"]),
    ).toMatchObject({ device: "iPhone 15", domain: "com.example.app" });
  });

  test("read captures --device long form", () => {
    expect(
      parseDefaultsArgs(["read", "com.example.app", "--device", "UDID-1"]),
    ).toMatchObject({ device: "UDID-1" });
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
        "write", "com.example.app", "Greeting", "--type", "string", "hello world",
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
    expect(
      parseDefaultsArgs(["write", "com.example.app", "K", "--type", "string"]),
    ).toEqual({ error: expect.stringContaining("value") });
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
