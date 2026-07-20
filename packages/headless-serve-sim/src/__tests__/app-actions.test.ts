import { describe, expect, test } from "bun:test";
import { createAppActions, parseAppActionsArgs } from "../app-actions";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

describe("parseAppActionsArgs", () => {
  // ─── open-url ───

  test("open-url with an https URL", () => {
    expect(parseAppActionsArgs(["open-url", "https://example.com"])).toEqual({
      verb: "open-url",
      url: "https://example.com",
      device: undefined,
      quiet: false,
    });
  });

  test("open-url with a custom scheme is accepted", () => {
    expect(parseAppActionsArgs(["open-url", "myapp://path/to/thing"])).toMatchObject({
      verb: "open-url",
      url: "myapp://path/to/thing",
    });
  });

  test("open-url with no scheme is rejected", () => {
    expect(parseAppActionsArgs(["open-url", "not a url"])).toEqual({
      error: expect.stringContaining("URL"),
    });
  });

  test("open-url with a missing URL positional is an error", () => {
    expect(parseAppActionsArgs(["open-url"])).toEqual({
      error: expect.stringContaining("Missing URL"),
    });
  });

  // ─── push ───

  test("push --payload parses verb/bundleId/payload", () => {
    expect(
      parseAppActionsArgs([
        "push",
        "com.apple.mobilesafari",
        "--payload",
        '{"aps":{"alert":"hi"}}',
      ]),
    ).toEqual({
      verb: "push",
      bundleId: "com.apple.mobilesafari",
      payload: '{"aps":{"alert":"hi"}}',
      device: undefined,
      quiet: false,
    });
  });

  test("push with a reverse-dns bundleId is accepted; an invalid one is rejected", () => {
    expect(
      parseAppActionsArgs(["push", "com.apple.mobilesafari", "--payload", '{"aps":{}}']),
    ).toMatchObject({ bundleId: "com.apple.mobilesafari" });
    expect(parseAppActionsArgs(["push", "com apple", "--payload", '{"aps":{}}'])).toEqual({
      error: expect.stringContaining("Invalid bundle id"),
    });
  });

  test("push --file parses the path (no existence check in the parser)", () => {
    expect(
      parseAppActionsArgs(["push", "com.apple.mobilesafari", "--file", "/tmp/p.apns"]),
    ).toEqual({
      verb: "push",
      bundleId: "com.apple.mobilesafari",
      file: "/tmp/p.apns",
      device: undefined,
      quiet: false,
    });
  });

  test("push --payload with invalid JSON is rejected and does not reach simctl", () => {
    expect(parseAppActionsArgs(["push", "com.apple.mobilesafari", "--payload", "notjson"])).toEqual(
      { error: expect.stringContaining("Invalid JSON") },
    );
  });

  test("push --payload without an 'aps' key is rejected", () => {
    expect(
      parseAppActionsArgs(["push", "com.apple.mobilesafari", "--payload", '{"foo":1}']),
    ).toEqual({ error: expect.stringContaining("aps") });
  });

  test("push --payload with a non-object (array) JSON is rejected", () => {
    expect(parseAppActionsArgs(["push", "com.apple.mobilesafari", "--payload", "[1,2,3]"])).toEqual(
      { error: expect.stringContaining("object") },
    );
  });

  test("push with neither --payload nor --file is rejected (exactly one required)", () => {
    expect(parseAppActionsArgs(["push", "com.apple.mobilesafari"])).toEqual({
      error: expect.stringContaining("exactly one"),
    });
  });

  test("push with BOTH --payload and --file is rejected (exactly one required)", () => {
    expect(
      parseAppActionsArgs([
        "push",
        "com.apple.mobilesafari",
        "--payload",
        '{"aps":{}}',
        "--file",
        "/tmp/p.apns",
      ]),
    ).toEqual({ error: expect.stringContaining("exactly one") });
  });

  test("push with a missing bundle id is an error", () => {
    expect(parseAppActionsArgs(["push"])).toEqual({
      error: expect.stringContaining("Missing bundle id"),
    });
  });

  // ─── keychain-reset ───

  test("keychain-reset parses with no positionals", () => {
    expect(parseAppActionsArgs(["keychain-reset"])).toEqual({
      verb: "keychain-reset",
      device: undefined,
      quiet: false,
    });
  });

  // ─── flags shared across sub-verbs ───

  test("-d/--device is captured (short and long form)", () => {
    expect(parseAppActionsArgs(["open-url", "https://x.test", "-d", "iPhone 15"])).toMatchObject({
      device: "iPhone 15",
    });
    expect(parseAppActionsArgs(["keychain-reset", "--device", "UDID-1"])).toMatchObject({
      device: "UDID-1",
    });
  });

  test("--device=UDID form is captured", () => {
    expect(parseAppActionsArgs(["keychain-reset", "--device", "UDID-2"])).toMatchObject({
      device: "UDID-2",
    });
  });

  test("--payload=value and --file=value forms are parsed", () => {
    expect(
      parseAppActionsArgs(["push", "com.apple.mobilesafari", '--payload={"aps":{"alert":"hi"}}']),
    ).toMatchObject({ payload: '{"aps":{"alert":"hi"}}' });
    expect(
      parseAppActionsArgs(["push", "com.apple.mobilesafari", "--file=/tmp/p.apns"]),
    ).toMatchObject({ file: "/tmp/p.apns" });
  });

  test("-q/--quiet sets the quiet flag", () => {
    expect(parseAppActionsArgs(["keychain-reset", "-q"])).toMatchObject({ quiet: true });
    expect(parseAppActionsArgs(["keychain-reset", "--quiet"])).toMatchObject({ quiet: true });
  });

  // ─── error paths ───

  test("unknown flag is rejected", () => {
    expect(parseAppActionsArgs(["keychain-reset", "--bogus"])).toEqual({
      error: expect.stringContaining("Unknown flag"),
    });
  });

  test("missing value for -d is an error", () => {
    expect(parseAppActionsArgs(["open-url", "https://x.test", "-d"])).toEqual({
      error: expect.stringContaining("Missing value for -d"),
    });
  });

  test("missing subcommand is an error", () => {
    expect(parseAppActionsArgs([])).toEqual({
      error: expect.stringContaining("Missing subcommand"),
    });
  });

  test("unknown subcommand is an error", () => {
    expect(parseAppActionsArgs(["launch", "com.apple.mobilesafari"])).toEqual({
      error: expect.stringContaining("Unknown subcommand"),
    });
  });
});

describe("app actions module", () => {
  test("translates every action to argv-only host commands", async () => {
    const host = createScriptedHostCommands([{}, {}, {}, {}]);
    const actions = createAppActions(host, { fileExists: () => true });

    await actions.execute("DEVICE", {
      verb: "open-url",
      url: "myapp://screen",
      quiet: false,
    });
    await actions.execute("DEVICE", { verb: "keychain-reset", quiet: false });
    await actions.execute("DEVICE", {
      verb: "push",
      bundleId: "com.example.app",
      payload: '{"aps":{}}',
      quiet: false,
    });
    await actions.execute("DEVICE", {
      verb: "push",
      bundleId: "com.example.app",
      file: "/tmp/payload.apns",
      quiet: false,
    });

    expect(host.calls.map((call) => call.request)).toEqual([
      {
        executable: "xcrun",
        args: ["simctl", "openurl", "DEVICE", "myapp://screen"],
        stdio: "capture",
      },
      { executable: "xcrun", args: ["simctl", "keychain", "DEVICE", "reset"], stdio: "capture" },
      {
        executable: "xcrun",
        args: ["simctl", "push", "DEVICE", "com.example.app", "-"],
        input: '{"aps":{}}',
        stdio: "capture",
      },
      {
        executable: "xcrun",
        args: ["simctl", "push", "DEVICE", "com.example.app", "/tmp/payload.apns"],
        stdio: "capture",
      },
    ]);
  });

  test("missing payload files are rejected before host commands", async () => {
    const host = createScriptedHostCommands();
    const actions = createAppActions(host, { fileExists: () => false });

    await expect(
      actions.execute("DEVICE", {
        verb: "push",
        bundleId: "com.example.app",
        file: "/missing.apns",
        quiet: false,
      }),
    ).rejects.toThrow("Payload file not found");
    expect(host.calls).toEqual([]);
  });
});
