import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import { findBootedDevice, resolveDevice } from "./device";

// ─── Argument parsing ───
//
// `document import <file...> [--into <subfolder>] [--name <filename>] [-d <udid|name>] [-q]`
//
// Imports files into the simulator's Files app "On My iPad/iPhone" local
// storage (the `group.com.apple.FileProvider.LocalStorage` app group), so they
// show up directly in Browse → On My iPad with no in-app document picker.

export type Verb = "import";

export interface ParsedDocImport {
  verb: Verb;
  files: string[];
  /** Optional subfolder under "On My iPad", created if missing. */
  into?: string;
  /**
   * Override the destination filename. Only valid for a single file — the web
   * UI uses this to restore the real name of a file it staged under a temp
   * UUID path.
   */
  name?: string;
  device?: string;
  quiet: boolean;
}

// A bare filename: no path separators, not "." / "..".
const FILENAME_RE = /^[^/]+$/;

function normalizeInto(raw: string): string | { error: string } {
  if (raw.startsWith("/")) return { error: `Invalid --into "${raw}": must be a relative subfolder` };
  const segments = raw.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) {
    return { error: `Invalid --into "${raw}": path traversal is not allowed` };
  }
  return segments.join("/");
}

export function parseDocumentArgs(
  args: string[],
): ParsedDocImport | { error: string } {
  let device: string | undefined;
  let into: string | undefined;
  let name: string | undefined;
  let quiet = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--device") {
      device = args[++i];
      if (!device) return { error: "Missing value for -d/--device" };
    } else if (a === "--into") {
      const v = args[++i];
      if (v === undefined) return { error: "Missing value for --into" };
      const norm = normalizeInto(v);
      if (typeof norm !== "string") return norm;
      into = norm || undefined;
    } else if (a.startsWith("--into=")) {
      const norm = normalizeInto(a.slice("--into=".length));
      if (typeof norm !== "string") return norm;
      into = norm || undefined;
    } else if (a === "--name") {
      name = args[++i];
      if (name === undefined) return { error: "Missing value for --name" };
    } else if (a.startsWith("--name=")) {
      name = a.slice("--name=".length);
    } else if (a === "-q" || a === "--quiet") {
      quiet = true;
    } else if (a.startsWith("-")) {
      return { error: `Unknown flag: ${a}` };
    } else {
      positional.push(a);
    }
  }

  const verbRaw = positional[0];
  if (!verbRaw) return { error: "Missing subcommand: import" };
  if (verbRaw !== "import") return { error: `Unknown subcommand: ${verbRaw}` };

  const files = positional.slice(1);
  if (files.length === 0) return { error: "Missing file(s) to import" };

  if (name !== undefined) {
    if (files.length > 1) {
      return { error: "--name can only be used with a single file" };
    }
    if (!FILENAME_RE.test(name) || name === "." || name === "..") {
      return { error: `Invalid --name "${name}": must be a bare filename` };
    }
  }

  return { verb: "import", files, into, name, device, quiet };
}

// ─── Simulator "On My iPad" local storage ───

/**
 * Resolve the Files app local-storage directory ("On My iPad/iPhone") for a
 * device. Files copied here surface directly in Browse → On My iPad.
 */
const LOCAL_STORAGE_GROUP = "group.com.apple.FileProvider.LocalStorage";

export function localStorageDir(udid: string): string {
  // Primary: list the Files app's app-group containers and pick LocalStorage.
  // The group GUID is randomized per device, so it must be resolved, never
  // hardcoded. (A single-group `get_app_container ... <group-id>` lookup is
  // rejected for system apps on iOS 26, so parse the `groups` listing instead.)
  try {
    const out = execFileSync(
      "xcrun",
      ["simctl", "get_app_container", udid, "com.apple.DocumentsApp", "groups"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const line of out.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      if (line.slice(0, tab).trim() === LOCAL_STORAGE_GROUP) {
        return join(line.slice(tab + 1).trim(), "File Provider Storage");
      }
    }
  } catch {
    // Fall through to the on-disk scan below.
  }

  // Fallback: scan the device's shared app groups for the LocalStorage group.
  // Useful on a cold boot before the Files app has registered with simctl.
  const groupsDir = join(
    homedir(),
    "Library/Developer/CoreSimulator/Devices",
    udid,
    "data/Containers/Shared/AppGroup",
  );
  if (existsSync(groupsDir)) {
    for (const entry of readdirSync(groupsDir)) {
      const meta = join(groupsDir, entry, ".com.apple.mobile_container_manager.metadata.plist");
      if (!existsSync(meta)) continue;
      try {
        const xml = execFileSync("plutil", ["-convert", "xml1", "-o", "-", meta], {
          encoding: "utf-8",
        });
        if (xml.includes(LOCAL_STORAGE_GROUP)) {
          return join(groupsDir, entry, "File Provider Storage");
        }
      } catch {
        // Ignore unreadable metadata and keep scanning.
      }
    }
  }

  throw new Error(
    `Could not locate the Files app local storage for ${udid}. ` +
      `Is the simulator booted?`,
  );
}

// ─── Command entry ───

export async function document(args: string[]): Promise<void> {
  const parsed = parseDocumentArgs(args);

  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(
      "\nUsage:\n" +
        "  headless-serve-sim document import <file...> [--into <subfolder>] [-d <udid|name>]\n" +
        "\nImports files into the simulator's Files app under On My iPad/iPhone.",
    );
    process.exit(1);
  }

  const udid = parsed.device ? resolveDevice(parsed.device) : findBootedDevice();
  if (!udid) {
    console.error("No booted simulator. Boot one or pass -d <udid|name>.");
    process.exit(1);
  }

  const sources = parsed.files.map((f) => resolve(f));
  const missing = sources.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    console.error(`File(s) not found:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }

  let targetDir: string;
  try {
    const baseDir = localStorageDir(udid);
    targetDir = parsed.into ? join(baseDir, parsed.into) : baseDir;
    mkdirSync(targetDir, { recursive: true });
  } catch (e: any) {
    console.error(e?.message ?? String(e));
    process.exit(1);
  }

  const imported: Array<{ name: string; path: string }> = [];
  try {
    for (const src of sources) {
      const destName = parsed.name ?? basename(src);
      const dest = join(targetDir, destName);
      copyFileSync(src, dest); // overwrites an existing file by default
      imported.push({ name: destName, path: dest });
    }
  } catch (e: any) {
    console.error(`Import failed: ${e?.message ?? String(e)}`);
    process.exit(1);
  }

  const location = parsed.into ? `On My iPad/${parsed.into}` : "On My iPad";
  if (parsed.quiet) {
    console.log(JSON.stringify({ udid, into: parsed.into ?? null, imported }));
  } else {
    const names = imported.map((f) => f.name).join(", ");
    console.log(`📄 imported ${imported.length} file(s) → ${location} on ${udid}\n   ${names}`);
  }
  process.exit(0);
}
