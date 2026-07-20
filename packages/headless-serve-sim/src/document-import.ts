import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import { findBootedDevice, resolveDevice } from "./device";
import type { HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";

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
  if (raw.startsWith("/"))
    return { error: `Invalid --into "${raw}": must be a relative subfolder` };
  const segments = raw.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) {
    return { error: `Invalid --into "${raw}": path traversal is not allowed` };
  }
  return segments.join("/");
}

export function parseDocumentArgs(args: string[]): ParsedDocImport | { error: string } {
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

export interface DocumentFileSystem {
  exists(path: string): boolean;
  list(path: string): string[];
  makeDirectory(path: string): void;
  copy(source: string, destination: string): void;
  homeDirectory(): string;
  resolvePath(path: string): string;
}

export interface ImportedDocument {
  name: string;
  path: string;
}

export interface DocumentImporterModule {
  localStorageDir(udid: string): string;
  importFiles(udid: string, request: ParsedDocImport): ImportedDocument[];
}

const nodeDocumentFiles: DocumentFileSystem = {
  exists: existsSync,
  list: readdirSync,
  makeDirectory: (path) => mkdirSync(path, { recursive: true }),
  copy: copyFileSync,
  homeDirectory: homedir,
  resolvePath: resolve,
};

export function createDocumentImporter(
  host: HostCommands,
  files: DocumentFileSystem = nodeDocumentFiles,
): DocumentImporterModule {
  const tryRun = (executable: string, args: readonly string[]): Buffer | null => {
    try {
      const result = host.run({ executable, args, stdio: "capture" }, "sync");
      return result.exitCode === 0 && !result.timedOut ? result.stdout : null;
    } catch {
      return null;
    }
  };

  const storageDir = (udid: string): string => {
    const groups = tryRun("xcrun", [
      "simctl",
      "get_app_container",
      udid,
      "com.apple.DocumentsApp",
      "groups",
    ]);
    if (groups) {
      for (const line of groups.toString().split("\n")) {
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        if (line.slice(0, tab).trim() === LOCAL_STORAGE_GROUP) {
          return join(line.slice(tab + 1).trim(), "File Provider Storage");
        }
      }
    }

    const groupsDir = join(
      files.homeDirectory(),
      "Library/Developer/CoreSimulator/Devices",
      udid,
      "data/Containers/Shared/AppGroup",
    );
    if (files.exists(groupsDir)) {
      for (const entry of files.list(groupsDir)) {
        const metadata = join(
          groupsDir,
          entry,
          ".com.apple.mobile_container_manager.metadata.plist",
        );
        if (!files.exists(metadata)) continue;
        const xml = tryRun("plutil", ["-convert", "xml1", "-o", "-", metadata]);
        if (xml?.toString().includes(LOCAL_STORAGE_GROUP)) {
          return join(groupsDir, entry, "File Provider Storage");
        }
      }
    }

    throw new Error(
      `Could not locate the Files app local storage for ${udid}. ` + "Is the simulator booted?",
    );
  };

  return {
    localStorageDir: storageDir,
    importFiles(udid, request) {
      const sources = request.files.map(files.resolvePath);
      const missing = sources.filter((path) => !files.exists(path));
      if (missing.length > 0) {
        throw new Error(`File(s) not found:\n  ${missing.join("\n  ")}`);
      }
      const baseDir = storageDir(udid);
      const targetDir = request.into ? join(baseDir, request.into) : baseDir;
      files.makeDirectory(targetDir);

      const imported: ImportedDocument[] = [];
      try {
        for (const source of sources) {
          const name = request.name ?? basename(source);
          const path = join(targetDir, name);
          files.copy(source, path);
          imported.push({ name, path });
        }
      } catch (error: unknown) {
        throw new Error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return imported;
    },
  };
}

let productionImporter: DocumentImporterModule | null = null;

function productionDocumentImporter(): DocumentImporterModule {
  productionImporter ??= createDocumentImporter(createNodeHostCommands());
  return productionImporter;
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

  let imported: ImportedDocument[];
  try {
    imported = productionDocumentImporter().importFiles(udid, parsed);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
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
