import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandRequest, CommandResult, HostCommands } from "./runtime/host-commands";

export interface PermissionsDependencies {
  host: HostCommands;
  findBootedDevice(): string | null;
  resolveDevice(device: string): string | null;
  simulatorLibraryDir(udid: string): string;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  now(): number;
  sleep(milliseconds: number): void;
}

// ─── Permission catalogue ───

type PermissionKind = "tcc" | "notifications" | "location";

interface PermissionSpec {
  kind: PermissionKind;
  /** TCC service identifier, for `kind === "tcc"`. */
  tccService?: string;
  /** TCC `auth_version` column — photos uses 2, everything else 1. */
  tccAuthVersion?: number;
  /** Whether `--value` is meaningful for this permission. */
  values?: string[];
}

const TCC_SERVICES: Record<string, string> = {
  camera: "kTCCServiceCamera",
  microphone: "kTCCServiceMicrophone",
  photos: "kTCCServicePhotos",
  "photos-add": "kTCCServicePhotosAdd",
  contacts: "kTCCServiceAddressBook",
  calendar: "kTCCServiceCalendar",
  reminders: "kTCCServiceReminders",
  motion: "kTCCServiceMotion",
  "media-library": "kTCCServiceMediaLibrary",
  siri: "kTCCServiceSiri",
  speech: "kTCCServiceSpeechRecognition",
  faceid: "kTCCServiceFaceID",
  "user-tracking": "kTCCServiceUserTracking",
  homekit: "kTCCServiceWillow",
};

// Names that map onto a canonical permission, sometimes pinning a `--value`.
const ALIASES: Record<string, { permission: string; value?: string }> = {
  push: { permission: "notifications" },
  notification: { permission: "notifications" },
  "photo-library": { permission: "photos" },
  photo: { permission: "photos" },
  "location-always": { permission: "location", value: "always" },
  "location-in-use": { permission: "location", value: "inuse" },
  "location-inuse": { permission: "location", value: "inuse" },
  mic: { permission: "microphone" },
};

export function resolvePermission(name: string): PermissionSpec | null {
  if (name === "notifications") return { kind: "notifications", values: ["critical"] };
  if (name === "location") return { kind: "location", values: ["always", "inuse", "never"] };
  const service = TCC_SERVICES[name];
  if (service) {
    return {
      kind: "tcc",
      tccService: service,
      tccAuthVersion: name === "photos" ? 2 : 1,
      values: name === "photos" ? ["limited"] : undefined,
    };
  }
  return null;
}

/** Every canonical permission name, used by `reset all` and `--help`. */
export function allPermissionNames(): string[] {
  return ["notifications", "location", ...Object.keys(TCC_SERVICES)];
}

// ─── Argument parsing ───

export type Verb = "grant" | "revoke" | "reset" | "list";

export interface ParsedArgs {
  verb: Verb;
  /** Canonical permission name, or "all" for `reset all`. Absent for `list`. */
  permission?: string;
  value?: string;
  bundleId?: string;
  device?: string;
}

const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

export function parsePermissionsArgs(args: string[]): ParsedArgs | { error: string } {
  let device: string | undefined;
  let value: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--device") {
      device = args[++i];
      if (!device) return { error: "Missing value for -d/--device" };
    } else if (a === "--value") {
      value = args[++i];
      if (value === undefined) return { error: "Missing value for --value" };
    } else if (a.startsWith("--value=")) {
      value = a.slice("--value=".length);
    } else if (a.startsWith("-")) {
      return { error: `Unknown flag: ${a}` };
    } else {
      positional.push(a);
    }
  }

  const verbRaw = positional[0];
  if (!verbRaw) return { error: "Missing subcommand: grant | revoke | reset | list" };
  const verb: Verb | undefined = (
    { grant: "grant", revoke: "revoke", deny: "revoke", reset: "reset", list: "list" } as const
  )[verbRaw];
  if (!verb) return { error: `Unknown subcommand: ${verbRaw}` };

  if (verb === "list") {
    // permissions list [bundle-id] [-d udid]
    const bundleId = positional[1];
    if (bundleId && !BUNDLE_ID_RE.test(bundleId)) {
      return { error: `Invalid bundle id: ${bundleId}` };
    }
    return { verb, bundleId, device };
  }

  let permission = positional[1];
  if (!permission) return { error: `Missing permission name for "${verb}"` };

  // `reset all` is a special case — no bundle-scoped permission lookup.
  if (verb === "reset" && permission === "all") {
    const bundleId = positional[2];
    if (!bundleId) return { error: "Missing bundle id for `reset all`" };
    if (!BUNDLE_ID_RE.test(bundleId)) return { error: `Invalid bundle id: ${bundleId}` };
    return { verb, permission: "all", bundleId, device };
  }

  // Resolve aliases (may pin a value).
  const alias = ALIASES[permission];
  if (alias) {
    permission = alias.permission;
    if (alias.value && !value) value = alias.value;
  }

  const spec = resolvePermission(permission);
  if (!spec) {
    return {
      error: `Unknown permission: ${positional[1]}\nSupported: ${allPermissionNames().join(", ")}`,
    };
  }

  const bundleId = positional[2];
  if (!bundleId) return { error: `Missing bundle id for "${verb} ${permission}"` };
  if (!BUNDLE_ID_RE.test(bundleId)) return { error: `Invalid bundle id: ${bundleId}` };

  // A trailing positional (4th arg) is also accepted as the value, matching
  // applesimutils' `permission grant photos limited` shape.
  if (!value && positional[3]) value = positional[3];

  if (value !== undefined) {
    if (!spec.values || !spec.values.includes(value)) {
      const allowed = spec.values ? spec.values.join(", ") : "(none)";
      return {
        error: `Invalid --value "${value}" for ${permission}. Allowed: ${allowed}`,
      };
    }
  }

  return { verb, permission, value, bundleId, device };
}

function commandFailure(
  request: CommandRequest,
  result: CommandResult,
): Error & { stdout: Buffer; stderr: Buffer } {
  const target =
    "shell" in request ? request.shell : [request.executable, ...(request.args ?? [])].join(" ");
  const error = new Error(
    result.stderr.toString().trim() ||
      `Command failed (${result.exitCode ?? result.signal ?? "unknown"}): ${target}`,
  ) as Error & { stdout: Buffer; stderr: Buffer };
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  return error;
}

function errorText(error: unknown, properties: readonly string[] = ["message"]): string {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    for (const property of properties) {
      const value = record[property];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return String(error).trim();
}

function runCommand(host: HostCommands, request: CommandRequest): CommandResult {
  const result = host.run(request, "sync");
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
    throw commandFailure(request, result);
  }
  return result;
}

function dependencyPath(
  dependencies: PermissionsDependencies,
  udid: string,
  relative: string,
): string {
  return join(dependencies.simulatorLibraryDir(udid), relative);
}

// ─── TCC.db writer ───

function withSqliteRetry<T>(dependencies: PermissionsDependencies, fn: () => T): T {
  const deadline = dependencies.now() + 5000;
  for (;;) {
    try {
      return fn();
    } catch (error: unknown) {
      const msg = errorText(error, ["stderr", "message"]);
      if (dependencies.now() < deadline && /database is locked|database is busy/i.test(msg)) {
        // Boot race — CoreSimulator briefly holds TCC.db. Retry.
        dependencies.sleep(200);
        continue;
      }
      throw error;
    }
  }
}

function sqlite(dependencies: PermissionsDependencies, dbPath: string, sql: string): string {
  return withSqliteRetry(dependencies, () =>
    runCommand(dependencies.host, {
      executable: "sqlite3",
      args: [dbPath, sql],
      stdio: "capture",
    }).stdout.toString(),
  );
}

function writeTcc(
  dependencies: PermissionsDependencies,
  udid: string,
  service: string,
  authVersion: number,
  bundleId: string,
  authValue: number | "delete",
): void {
  const db = dependencyPath(dependencies, udid, "TCC/TCC.db");
  if (!existsSync(db)) {
    throw new Error(`TCC.db not found for ${udid}. Is the simulator booted?\n  ${db}`);
  }
  // `service` comes from our fixed catalogue and `bundleId` is regex-validated
  // by the parser, so direct interpolation here cannot inject SQL.
  sqlite(
    dependencies,
    db,
    `DELETE FROM access WHERE service='${service}' AND client='${bundleId}' AND client_type=0;`,
  );
  if (authValue !== "delete") {
    sqlite(
      dependencies,
      db,
      `INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags) ` +
        `VALUES ('${service}', '${bundleId}', 0, ${authValue}, 2, ${authVersion}, 0);`,
    );
  }
}

// Reverse of TCC_SERVICES, so `list` reports the same permission names that
// grant/revoke/reset accept rather than raw kTCCService* database keys.
const TCC_NAME_BY_SERVICE: Record<string, string> = Object.fromEntries(
  Object.entries(TCC_SERVICES).map(([name, service]) => [service, name]),
);

function readTcc(
  dependencies: PermissionsDependencies,
  udid: string,
  bundleId?: string,
): Record<string, number> {
  const db = dependencyPath(dependencies, udid, "TCC/TCC.db");
  if (!existsSync(db)) return {};
  const where = bundleId ? ` WHERE client='${bundleId}'` : "";
  const out = sqlite(dependencies, db, `SELECT service, auth_value FROM access${where};`);
  const result: Record<string, number> = {};
  for (const line of out.split("\n")) {
    const [service, authValue] = line.split("|");
    if (service) result[TCC_NAME_BY_SERVICE[service] ?? service] = Number(authValue);
  }
  return result;
}

// ─── plist helpers ───

function plutil(dependencies: PermissionsDependencies, args: string[]): string {
  return runCommand(dependencies.host, {
    executable: "plutil",
    args,
    stdio: "capture",
  }).stdout.toString();
}

/**
 * Run PlistBuddy commands against a plist. PlistBuddy uses `:` as its key-path
 * separator, so dotted bundle ids work as literal key components — unlike
 * `plutil`, whose `.`-separated key paths can't address them and whose array
 * indices insert rather than replace.
 */
function plistBuddy(
  dependencies: PermissionsDependencies,
  file: string,
  commands: string[],
  opts: { ignoreErrors?: boolean } = {},
): string {
  const args: string[] = [];
  for (const c of commands) args.push("-c", c);
  args.push(file);
  try {
    return runCommand(dependencies.host, {
      executable: "/usr/libexec/PlistBuddy",
      args,
      stdio: "capture",
    }).stdout.toString();
  } catch (error: unknown) {
    if (opts.ignoreErrors) return errorText(error, ["stdout"]);
    throw new Error(errorText(error, ["stderr", "stdout", "message"]));
  }
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "headless-serve-sim-perm-"));
}

// ─── Location writer ───

// locationd owns clients.plist and keys app entries with an `i<bundleId>:`
// scheme — the trailing colon is part of the key, so neither plutil (dot
// paths) nor PlistBuddy (colon paths) can address it, and a hand-written
// plain-bundle-id entry is ignored. `simctl privacy` understands the format
// and is reliable specifically for location, so delegate to it here.
function setLocation(
  dependencies: PermissionsDependencies,
  udid: string,
  bundleId: string,
  mode: "grant" | "revoke" | "reset",
  value: string | undefined,
): void {
  let action = "grant";
  let service = "location";
  if (mode === "reset") {
    action = "reset";
  } else if (mode === "revoke" || value === "never") {
    action = "revoke";
  } else if (value === "always") {
    service = "location-always";
  }
  try {
    runCommand(dependencies.host, {
      executable: "xcrun",
      args: ["simctl", "privacy", udid, action, service, bundleId],
      stdio: "capture",
    });
  } catch (error: unknown) {
    throw new Error(
      `simctl privacy ${action} ${service} failed: ` + errorText(error, ["stderr", "message"]),
    );
  }
}

function readLocation(
  dependencies: PermissionsDependencies,
  udid: string,
  bundleId: string | undefined,
): { Authorization: number } | null {
  if (!bundleId) return null;
  const path = dependencyPath(dependencies, udid, "Caches/locationd/clients.plist");
  if (!existsSync(path)) return null;
  let xml: string;
  try {
    xml = plutil(dependencies, ["-convert", "xml1", "-o", "-", path]);
  } catch {
    return null;
  }
  const m = xml.match(
    new RegExp(
      `<key>i${bundleId.replace(/[.-]/g, "\\$&")}:</key>\\s*<dict>[\\s\\S]*?` +
        `<key>Authorization</key>\\s*<integer>(\\d+)</integer>`,
    ),
  );
  return m ? { Authorization: Number(m[1]) } : null;
}

// ─── Notifications writer ───

// Keyed-archive template for a single app's BulletinBoard section info, lifted
// verbatim from AppleSimulatorUtils (SetNotificationsPermission.m). `$objects`
// indices 2/3/5 are patched per-app: 2 = bundle id, 3 = the settings dict
// (allowsNotifications / criticalAlertSetting), 5 = display name.
const NOTIF_TEMPLATE_B64 =
  "YnBsaXN0MDDUAQIDBAUGTU5YJHZlcnNpb25YJG9iamVjdHNZJGFyY2hpdmVyVCR0b3ASAAGGoKgHCDAxQUgfSVUkbnVsbN8QFQkKCwwNDg8QERITFBUWFxgZGhscHR4fHiEiIx4jJicfHygjIh8jIyMjI18QFHN1cHByZXNzRnJvbVNldHRpbmdzXxASc3VwcHJlc3NlZFNldHRpbmdzWmhpZGVXZWVBcHBZc2VjdGlvbklEW2Rpc3BsYXlOYW1lVGljb25fEBlkaXNwbGF5c0NyaXRpY2FsQnVsbGV0aW5zW3N1YnNlY3Rpb25zXxATc2VjdGlvbkluZm9TZXR0aW5nc1YkY2xhc3NfEA9zZWN0aW9uQ2F0ZWdvcnlfEBJzdWJzZWN0aW9uUHJpb3JpdHlXdmVyc2lvbl8QGm1hbmFnZWRTZWN0aW9uSW5mb1NldHRpbmdzV2FwcE5hbWVbc2VjdGlvblR5cGVfEBBmYWN0b3J5U2VjdGlvbklEXxAPZGF0YVByb3ZpZGVySURzXHN1YnNlY3Rpb25JRFdmaWx0ZXJzXxAYcGF0aFRvV2VlQXBwUGx1Z2luQnVuZGxlCBAACIACgAWAAAiAAIADgAeABoAAgAWAAIAAgACAAIAAXxAmY29tLkxlb05hdGFuLkxOUG9wdXBDb250cm9sbGVyRXhhbXBsZS3ZMjM0NTY3Ejg5Ojs7Ox8fPjtAXHB1c2hTZXR0aW5nc18QGXNob3dzSW5Ob3RpZmljYXRpb25DZW50ZXJfEBNhbGxvd3NOb3RpZmljYXRpb25zXxAWc2hvd3NPbkV4dGVybmFsRGV2aWNlc18QFWNvbnRlbnRQcmV2aWV3U2V0dGluZ15jYXJQbGF5U2V0dGluZ18QEXNob3dzSW5Mb2NrU2NyZWVuWWFsZXJ0VHlwZRA/CQkJgAQJEAHSQkNERVokY2xhc3NuYW1lWCRjbGFzc2VzXxAVQkJTZWN0aW9uSW5mb1NldHRpbmdzokZHXxAVQkJTZWN0aW9uSW5mb1NldHRpbmdzWE5TT2JqZWN0V0xOUG9wdXDSQkNKS11CQlNlY3Rpb25JbmZvokxHXUJCU2VjdGlvbkluZm9fEA9OU0tleWVkQXJjaGl2ZXLRT1BUcm9vdIABAAgAEQAaACMALQAyADcAQABGAHMAigCfAKoAtADAAMUA4QDtAQMBCgEcATEBOQFWAV4BagF9AY8BnAGkAb8BwAHCAcMBxQHHAckBygHMAc4B0AHSAdQB1gHYAdoB3AHeAeACCQIcAikCRQJbAnQCjAKbAq8CuQK7ArwCvQK+AsACwQLDAsgC0wLcAvQC9wMPAxgDIAMlAzMDNgNEA1YDWQNeAAAAAAAAAgEAAAAAAAAAUQAAAAAAAAAAAAAAAAAAA2A=";

function bulletinPlistPath(dependencies: PermissionsDependencies, udid: string): string {
  return dependencyPath(dependencies, udid, "BulletinBoard/VersionedSectionInfo.plist");
}

/**
 * Write the per-app section-info keyed archive to a temp file and return its
 * path. The result is a binary plist suitable for `Import`ing as a `<data>`
 * value into the destination BulletinBoard plist.
 */
function buildSectionInfoBlob(
  dependencies: PermissionsDependencies,
  dir: string,
  bundleId: string,
  enabled: boolean,
  critical: boolean,
): string {
  const blob = join(dir, "section-info.plist");
  writeFileSync(blob, Buffer.from(NOTIF_TEMPLATE_B64, "base64"));
  plistBuddy(dependencies, blob, [
    `Set :$objects:2 ${bundleId}`,
    `Set :$objects:3:allowsNotifications ${enabled ? "true" : "false"}`,
    `Add :$objects:3:criticalAlertSetting integer ${critical ? 2 : 0}`,
    `Set :$objects:5 ${bundleId}`,
    "Save",
  ]);
  // PlistBuddy rewrites as XML; SpringBoard stores these archives as binary.
  plutil(dependencies, ["-convert", "binary1", blob]);
  return blob;
}

function setNotifications(
  dependencies: PermissionsDependencies,
  udid: string,
  bundleId: string,
  mode: "grant" | "critical" | "revoke" | "reset",
): void {
  const path = bulletinPlistPath(dependencies, udid);
  if (!existsSync(path)) {
    // The plist appears shortly after SpringBoard starts. `reset` on a store
    // that doesn't exist yet is a no-op (nothing to clear); grant/revoke wait
    // briefly for it before giving up.
    if (mode === "reset") return;
    const deadline = dependencies.now() + 5000;
    while (!existsSync(path) && dependencies.now() < deadline) {
      dependencies.sleep(250);
    }
    if (!existsSync(path)) {
      throw new Error(
        `BulletinBoard plist not found for ${udid}. The simulator may still ` +
          `be booting — wait for it to finish and retry.\n  ${path}`,
      );
    }
  }

  // VersionedSectionInfo.plist is held immutable so SpringBoard doesn't clobber
  // it; clear the flag to edit, restore it afterwards.
  try {
    runCommand(dependencies.host, {
      executable: "chflags",
      args: ["nouchg", path],
      stdio: "capture",
    });
  } catch {}

  const tmp = makeTmpDir();
  try {
    // Drop any existing entry so grant/revoke/reset are all idempotent.
    plistBuddy(dependencies, path, [`Delete :sectionInfo:${bundleId}`, "Save"], {
      ignoreErrors: true,
    });
    if (mode !== "reset") {
      const blob = buildSectionInfoBlob(
        dependencies,
        tmp,
        bundleId,
        mode !== "revoke",
        mode === "critical",
      );
      plistBuddy(dependencies, path, [`Import :sectionInfo:${bundleId} ${blob}`, "Save"]);
    }
    // PlistBuddy saves XML; keep the file binary like SpringBoard writes it.
    plutil(dependencies, ["-convert", "binary1", path]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    try {
      chmodSync(path, 0o644);
      runCommand(dependencies.host, {
        executable: "chflags",
        args: ["uchg", path],
        stdio: "capture",
      });
    } catch {}
  }
}

function readNotifications(
  dependencies: PermissionsDependencies,
  udid: string,
  bundleId: string | undefined,
): { allowsNotifications: boolean; critical: boolean } | null {
  if (!bundleId) return null;
  const path = bulletinPlistPath(dependencies, udid);
  if (!existsSync(path)) return null;
  let sectionInfo: string;
  try {
    sectionInfo = plutil(dependencies, ["-extract", "sectionInfo", "xml1", "-o", "-", path]);
  } catch {
    return null;
  }
  const m = sectionInfo.match(
    new RegExp(`<key>${bundleId.replace(/[.-]/g, "\\$&")}</key>\\s*<data>([\\s\\S]*?)</data>`),
  );
  if (!m?.[1]) return null;
  const tmp = makeTmpDir();
  try {
    const blob = join(tmp, "section-info.plist");
    writeFileSync(blob, Buffer.from(m[1].replace(/\s/g, ""), "base64"));
    const inner = plutil(dependencies, ["-convert", "xml1", "-o", "-", blob]);
    return {
      allowsNotifications: /<key>allowsNotifications<\/key>\s*<true\/>/.test(inner),
      critical: /<key>criticalAlertSetting<\/key>\s*<integer>2<\/integer>/.test(inner),
    };
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ─── Dispatch ───

function applyOne(
  dependencies: PermissionsDependencies,
  udid: string,
  verb: Exclude<Verb, "list">,
  permission: string,
  value: string | undefined,
  bundleId: string,
): void {
  const spec = resolvePermission(permission)!;
  if (spec.kind === "tcc") {
    const authValue: number | "delete" =
      verb === "reset" ? "delete" : verb === "revoke" ? 0 : value === "limited" ? 3 : 2;
    writeTcc(dependencies, udid, spec.tccService!, spec.tccAuthVersion!, bundleId, authValue);
  } else if (spec.kind === "notifications") {
    const mode =
      verb === "reset"
        ? "reset"
        : verb === "revoke"
          ? "revoke"
          : value === "critical"
            ? "critical"
            : "grant";
    setNotifications(dependencies, udid, bundleId, mode);
  } else {
    setLocation(dependencies, udid, bundleId, verb, value);
  }
}

export async function permissions(
  args: string[],
  dependencies: PermissionsDependencies,
): Promise<number> {
  const quiet = args.includes("-q") || args.includes("--quiet");
  const rest = args.filter((a) => a !== "-q" && a !== "--quiet");
  const parsed = parsePermissionsArgs(rest);

  if ("error" in parsed) {
    dependencies.writeStderr(parsed.error);
    dependencies.writeStderr(
      "\nUsage:\n" +
        "  headless-serve-sim permissions grant  <permission> <bundle-id> [--value <v>] [-d <udid|name>]\n" +
        "  headless-serve-sim permissions revoke <permission> <bundle-id> [-d <udid|name>]\n" +
        "  headless-serve-sim permissions reset  <permission|all> <bundle-id> [-d <udid|name>]\n" +
        "  headless-serve-sim permissions list   [bundle-id] [-d <udid|name>]\n" +
        `\nPermissions: ${allPermissionNames().join(", ")}`,
    );
    return 1;
  }

  const udid = parsed.device
    ? dependencies.resolveDevice(parsed.device)
    : dependencies.findBootedDevice();
  if (!udid) {
    dependencies.writeStderr("No booted simulator. Boot one or pass -d <udid|name>.");
    return 1;
  }

  if (parsed.verb === "list") {
    const result = {
      udid,
      bundleId: parsed.bundleId ?? null,
      tcc: readTcc(dependencies, udid, parsed.bundleId),
      location: readLocation(dependencies, udid, parsed.bundleId),
      notifications: readNotifications(dependencies, udid, parsed.bundleId),
    };
    dependencies.writeStdout(JSON.stringify(result, null, quiet ? 0 : 2));
    return 0;
  }

  const bundleId = parsed.bundleId!;
  try {
    if (parsed.permission === "all") {
      for (const name of allPermissionNames()) {
        applyOne(dependencies, udid, "reset", name, undefined, bundleId);
      }
    } else {
      applyOne(dependencies, udid, parsed.verb, parsed.permission!, parsed.value, bundleId);
    }
  } catch (error: unknown) {
    dependencies.writeStderr(errorText(error));
    return 1;
  }

  if (quiet) {
    dependencies.writeStdout(
      JSON.stringify({
        udid,
        verb: parsed.verb,
        permission: parsed.permission,
        value: parsed.value ?? null,
        bundleId,
      }),
    );
  } else {
    const valueStr = parsed.value ? ` (${parsed.value})` : "";
    dependencies.writeStdout(
      `🔐 ${parsed.verb} ${parsed.permission}${valueStr} for ${bundleId} on ${udid}`,
    );
  }
  return 0;
}
