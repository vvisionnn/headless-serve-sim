import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { permissions, type PermissionsDependencies } from "../permissions";
import {
  createScriptedHostCommands,
  type ScriptedCommand,
} from "../test-support/scripted-host-commands";

const UDID = "TEST-UDID";
const BUNDLE_ID = "com.example.app";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createHarness(results: readonly ScriptedCommand[] = []) {
  const root = mkdtempSync(join(tmpdir(), "permissions-test-"));
  roots.push(root);
  const libraryDir = join(root, "Library");
  mkdirSync(join(libraryDir, "TCC"), { recursive: true });
  writeFileSync(join(libraryDir, "TCC", "TCC.db"), "fixture");

  const host = createScriptedHostCommands(results);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let now = 0;
  const dependencies: PermissionsDependencies = {
    host,
    findBootedDevice: () => UDID,
    resolveDevice: () => UDID,
    simulatorLibraryDir: () => libraryDir,
    writeStdout: (message) => stdout.push(message),
    writeStderr: (message) => stderr.push(message),
    now: () => now,
    sleep: (milliseconds) => {
      now += milliseconds;
    },
  };
  return { dependencies, host, libraryDir, stdout, stderr };
}

function createBulletinStore(libraryDir: string): string {
  const directory = join(libraryDir, "BulletinBoard");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "VersionedSectionInfo.plist");
  writeFileSync(path, "fixture");
  return path;
}

describe("permissions behavior", () => {
  test("grant camera replaces the TCC row with auth value 2", async () => {
    const harness = createHarness([{}, {}]);

    const exitCode = await permissions(
      ["grant", "camera", BUNDLE_ID, "-d", UDID],
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(harness.host.calls.map((call) => call.request)).toEqual([
      {
        executable: "sqlite3",
        args: [
          join(harness.dependencies.simulatorLibraryDir(UDID), "TCC/TCC.db"),
          `DELETE FROM access WHERE service='kTCCServiceCamera' AND client='${BUNDLE_ID}' AND client_type=0;`,
        ],
        stdio: "capture",
      },
      {
        executable: "sqlite3",
        args: [
          join(harness.dependencies.simulatorLibraryDir(UDID), "TCC/TCC.db"),
          `INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags) VALUES ('kTCCServiceCamera', '${BUNDLE_ID}', 0, 2, 2, 1, 0);`,
        ],
        stdio: "capture",
      },
    ]);
    expect(harness.stdout).toEqual([`🔐 grant camera for ${BUNDLE_ID} on ${UDID}`]);
    expect(harness.stderr).toEqual([]);
    expect(harness.host.remaining).toBe(0);
  });

  test.each([
    ["revoke", "camera", undefined, 0, 1],
    ["grant", "photos", "limited", 3, 2],
  ] as const)(
    "%s %s writes the expected TCC authorization",
    async (verb, permission, value, authValue, authVersion) => {
      const harness = createHarness([{}, {}]);
      const args = [verb, permission, BUNDLE_ID, "-d", UDID];
      if (value) args.push("--value", value);

      expect(await permissions(args, harness.dependencies)).toBe(0);

      const insert = harness.host.calls[1]?.request;
      expect(insert && "args" in insert ? insert.args?.[1] : undefined).toBe(
        `INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags) ` +
          `VALUES ('${permission === "photos" ? "kTCCServicePhotos" : "kTCCServiceCamera"}', '${BUNDLE_ID}', 0, ${authValue}, 2, ${authVersion}, 0);`,
      );
      expect(harness.host.remaining).toBe(0);
    },
  );

  test("reset camera removes the existing TCC row without inserting one", async () => {
    const harness = createHarness([{}]);

    expect(
      await permissions(["reset", "camera", BUNDLE_ID, "-d", UDID], harness.dependencies),
    ).toBe(0);

    expect(harness.host.calls).toHaveLength(1);
    const request = harness.host.calls[0]?.request;
    expect(request && "args" in request ? request.args?.[1] : undefined).toBe(
      `DELETE FROM access WHERE service='kTCCServiceCamera' AND client='${BUNDLE_ID}' AND client_type=0;`,
    );
    expect(harness.host.remaining).toBe(0);
  });

  test.each([
    ["grant", "always", "grant", "location-always"],
    ["revoke", undefined, "revoke", "location"],
    ["reset", undefined, "reset", "location"],
  ] as const)(
    "%s location delegates the canonical privacy action",
    async (verb, value, action, service) => {
      const harness = createHarness([{}]);
      const args = [verb, "location", BUNDLE_ID, "-d", UDID];
      if (value) args.push("--value", value);

      expect(await permissions(args, harness.dependencies)).toBe(0);
      expect(harness.host.calls).toEqual([
        {
          kind: "run-sync",
          request: {
            executable: "xcrun",
            args: ["simctl", "privacy", UDID, action, service, BUNDLE_ID],
            stdio: "capture",
          },
        },
      ]);
      expect(harness.host.remaining).toBe(0);
    },
  );

  test("a failed privacy command returns an error without falling through to the host", async () => {
    const harness = createHarness([{ result: { exitCode: 1, stderr: "privacy denied" } }]);

    expect(
      await permissions(["grant", "location", BUNDLE_ID, "-d", UDID], harness.dependencies),
    ).toBe(1);
    expect(harness.stderr).toEqual(["simctl privacy grant location failed: privacy denied"]);
    expect(harness.host.calls).toHaveLength(1);
    expect(harness.host.remaining).toBe(0);
  });

  test.each([
    ["grant", undefined, "true", "0"],
    ["grant", "critical", "true", "2"],
    ["revoke", undefined, "false", "0"],
  ] as const)(
    "%s notifications writes the expected archived settings",
    async (verb, value, enabled, critical) => {
      const harness = createHarness(Array.from({ length: 7 }, () => ({})));
      const bulletinPath = createBulletinStore(harness.libraryDir);
      const args = [verb, "notifications", BUNDLE_ID, "-d", UDID];
      if (value) args.push("--value", value);

      expect(await permissions(args, harness.dependencies)).toBe(0);

      const commands = harness.host.calls.map((call) => call.request);
      expect(commands[0]).toEqual({
        executable: "chflags",
        args: ["nouchg", bulletinPath],
        stdio: "capture",
      });
      const plistBuddyCommands = commands
        .filter(
          (request) => "executable" in request && request.executable === "/usr/libexec/PlistBuddy",
        )
        .flatMap((request) => request.args ?? []);
      expect(plistBuddyCommands).toContain(`Delete :sectionInfo:${BUNDLE_ID}`);
      expect(plistBuddyCommands).toContain(`Set :$objects:3:allowsNotifications ${enabled}`);
      expect(plistBuddyCommands).toContain(
        `Add :$objects:3:criticalAlertSetting integer ${critical}`,
      );
      expect(
        plistBuddyCommands.some((arg) => arg.startsWith(`Import :sectionInfo:${BUNDLE_ID} `)),
      ).toBe(true);
      expect(commands.at(-1)).toEqual({
        executable: "chflags",
        args: ["uchg", bulletinPath],
        stdio: "capture",
      });
      expect(harness.host.remaining).toBe(0);
    },
  );

  test("reset notifications removes the archived settings without rebuilding them", async () => {
    const harness = createHarness(Array.from({ length: 4 }, () => ({})));
    createBulletinStore(harness.libraryDir);

    expect(
      await permissions(["reset", "notifications", BUNDLE_ID, "-d", UDID], harness.dependencies),
    ).toBe(0);

    const commands = harness.host.calls.map((call) => call.request);
    const plistBuddyCommands = commands
      .filter(
        (request) => "executable" in request && request.executable === "/usr/libexec/PlistBuddy",
      )
      .flatMap((request) => request.args ?? []);
    expect(plistBuddyCommands).toContain(`Delete :sectionInfo:${BUNDLE_ID}`);
    expect(plistBuddyCommands.some((arg) => arg.startsWith("Import "))).toBe(false);
    expect(harness.host.remaining).toBe(0);
  });

  test("reset all clears every permission kind through the same command interface", async () => {
    const harness = createHarness(Array.from({ length: 15 }, () => ({})));

    expect(await permissions(["reset", "all", BUNDLE_ID, "-d", UDID], harness.dependencies)).toBe(
      0,
    );

    const commands = harness.host.calls.map((call) => call.request);
    expect(
      commands.filter((request) => "executable" in request && request.executable === "sqlite3"),
    ).toHaveLength(14);
    expect(commands).toContainEqual({
      executable: "xcrun",
      args: ["simctl", "privacy", UDID, "reset", "location", BUNDLE_ID],
      stdio: "capture",
    });
    expect(harness.host.remaining).toBe(0);
  });

  test("list reports TCC, location, and notification state under CLI names", async () => {
    const locationDirectory = "Caches/locationd";
    const sectionBlob = Buffer.from("fixture archive").toString("base64");
    const harness = createHarness([
      {
        result: {
          stdout: "kTCCServiceCamera|2\n" + "kTCCServicePhotos|3\n",
        },
      },
      {
        result: {
          stdout:
            `<key>i${BUNDLE_ID}:</key><dict>` +
            "<key>Authorization</key><integer>4</integer></dict>",
        },
      },
      {
        result: {
          stdout: `<key>${BUNDLE_ID}</key><data>${sectionBlob}</data>`,
        },
      },
      {
        result: {
          stdout:
            "<key>allowsNotifications</key><true/>" +
            "<key>criticalAlertSetting</key><integer>2</integer>",
        },
      },
    ]);
    mkdirSync(join(harness.libraryDir, locationDirectory), { recursive: true });
    writeFileSync(join(harness.libraryDir, locationDirectory, "clients.plist"), "fixture");
    createBulletinStore(harness.libraryDir);

    expect(
      await permissions(["list", BUNDLE_ID, "-d", UDID, "--quiet"], harness.dependencies),
    ).toBe(0);

    expect(JSON.parse(harness.stdout[0]!)).toEqual({
      udid: UDID,
      bundleId: BUNDLE_ID,
      tcc: { camera: 2, photos: 3 },
      location: { Authorization: 4 },
      notifications: { allowsNotifications: true, critical: true },
    });
    expect(harness.stderr).toEqual([]);
    expect(harness.host.remaining).toBe(0);
  });
});
