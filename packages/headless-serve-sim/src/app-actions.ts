import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { findBootedDevice, resolveDevice } from "./device";

// ─── Argument parsing ───
//
// `app-actions open-url      <url> [-d <udid|name>] [-q]`
// `app-actions push          <bundle-id> (--payload <json> | --file <path>) [-d] [-q]`
// `app-actions keychain-reset [-d <udid|name>] [-q]`
//
// Drives three `xcrun simctl` primitives: `openurl`, `push`, and `keychain reset`.
// `push --payload` JSON-parses the payload in the PURE parser (no I/O) and
// requires a top-level object containing an `aps` key; the entry pipes it to
// `simctl push <udid> <bundle> -` via stdin (no temp file). `push --file` passes
// the path straight through after an existence guard in the entry.

export type Verb = "open-url" | "push" | "keychain-reset";

export interface ParsedAppActions {
  verb: Verb;
  url?: string;
  bundleId?: string;
  /** Inline JSON payload for `push`; piped to `simctl push … -` via stdin. */
  payload?: string;
  /** Path to an .apns/.json payload file for `push`. */
  file?: string;
  device?: string;
  quiet: boolean;
}

// Reverse-dns-ish bundle id. Same shape as permissions.ts / user-defaults.ts —
// no whitespace, quotes, or path traversal.
const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
// A URL with a scheme: a leading scheme (letter then letter/digit/+/-/.) and a
// non-empty remainder. Accepts http(s)/universal links and custom app schemes;
// rejects scheme-less input like "not a url".
const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:.+$/;

export function parseAppActionsArgs(
  args: string[],
): ParsedAppActions | { error: string } {
  let device: string | undefined;
  let payload: string | undefined;
  let file: string | undefined;
  let quiet = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--device") {
      device = args[++i];
      if (device === undefined) return { error: "Missing value for -d/--device" };
    } else if (a === "--payload") {
      payload = args[++i];
      if (payload === undefined) return { error: "Missing value for --payload" };
    } else if (a.startsWith("--payload=")) {
      payload = a.slice("--payload=".length);
    } else if (a === "--file") {
      file = args[++i];
      if (file === undefined) return { error: "Missing value for --file" };
    } else if (a.startsWith("--file=")) {
      file = a.slice("--file=".length);
    } else if (a === "-q" || a === "--quiet") {
      quiet = true;
    } else if (a.startsWith("-") && a !== "-") {
      return { error: `Unknown flag: ${a}` };
    } else {
      positional.push(a);
    }
  }

  const verbRaw = positional[0];
  if (!verbRaw) return { error: "Missing subcommand: open-url | push | keychain-reset" };
  if (verbRaw !== "open-url" && verbRaw !== "push" && verbRaw !== "keychain-reset") {
    return { error: `Unknown subcommand: ${verbRaw}` };
  }
  const verb: Verb = verbRaw;

  if (verb === "open-url") {
    const url = positional[1];
    if (url === undefined) return { error: "Missing URL for open-url" };
    if (!URL_RE.test(url)) {
      return {
        error: `Invalid URL: ${url} (expected a scheme like https:// or myapp://)`,
      };
    }
    if (positional.length > 2) {
      return { error: `Unexpected argument: ${positional[2]} (did you forget -d before a device name, or quotes around the URL?)` };
    }
    return { verb, url, device, quiet };
  }

  if (verb === "keychain-reset") {
    if (positional.length > 1) {
      return { error: `Unexpected argument: ${positional[1]} (keychain-reset takes no positional arguments)` };
    }
    return { verb, device, quiet };
  }

  // verb === "push": needs a bundle id and EXACTLY ONE of --payload / --file.
  const bundleId = positional[1];
  if (bundleId === undefined) return { error: "Missing bundle id for push" };
  if (!BUNDLE_ID_RE.test(bundleId)) return { error: `Invalid bundle id: ${bundleId}` };
  if (positional.length > 2) {
    return { error: `Unexpected argument: ${positional[2]} (did you forget -d before a device name?)` };
  }

  if (payload !== undefined && file !== undefined) {
    return { error: "Pass exactly one of --payload or --file, not both." };
  }
  if (payload === undefined && file === undefined) {
    return { error: "push requires exactly one of --payload <json> or --file <path>." };
  }

  if (payload !== undefined) {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      return { error: "Invalid JSON payload (could not parse --payload)." };
    }
    if (parsedPayload === null || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
      return { error: "Invalid push payload: expected a JSON object." };
    }
    if (!("aps" in parsedPayload)) {
      return { error: "Invalid push payload: missing required 'aps' key." };
    }
    return { verb, bundleId, payload, device, quiet };
  }

  return { verb, bundleId, file, device, quiet };
}

// ─── Command entry ───

const USAGE =
  "\nUsage:\n" +
  "  headless-serve-sim app-actions open-url <url> [-d <udid|name>]\n" +
  "  headless-serve-sim app-actions push <bundle-id> (--payload <json> | --file <path>) [-d <udid|name>]\n" +
  "  headless-serve-sim app-actions keychain-reset [-d <udid|name>]\n" +
  "\nopen-url accepts http(s)/universal links and custom app schemes. push needs an\n" +
  "installed target app and a payload containing an 'aps' dict.";

export async function appActions(args: string[]): Promise<void> {
  const quiet = args.includes("-q") || args.includes("--quiet");
  const rest = args.filter((a) => a !== "-q" && a !== "--quiet");
  const parsed = parseAppActionsArgs(rest);

  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exit(1);
  }

  const udid = parsed.device ? resolveDevice(parsed.device) : findBootedDevice();
  if (!udid) {
    console.error("No booted simulator. Boot one or pass -d <udid|name>.");
    process.exit(1);
  }

  // url is URL_RE-validated, bundleId is BUNDLE_ID_RE-validated, and every value
  // is a discrete argv element (never shell-interpolated), so direct use here
  // cannot inject.
  try {
    if (parsed.verb === "open-url") {
      execFileSync("xcrun", ["simctl", "openurl", udid, parsed.url!], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (parsed.verb === "keychain-reset") {
      execFileSync("xcrun", ["simctl", "keychain", udid, "reset"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else if (parsed.payload !== undefined) {
      // Pipe the inline payload to `simctl push … -` via stdin — no temp file.
      // stdin MUST be "pipe" (not "ignore") so `input` reaches simctl.
      execFileSync("xcrun", ["simctl", "push", udid, parsed.bundleId!, "-"], {
        input: parsed.payload,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      const path = resolve(parsed.file!);
      if (!existsSync(path)) {
        console.error(`Payload file not found: ${path}`);
        process.exit(1);
      }
      execFileSync("xcrun", ["simctl", "push", udid, parsed.bundleId!, path], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  } catch (e: any) {
    console.error(String(e?.stderr ?? e?.message ?? e).trim());
    process.exit(1);
  }

  if (quiet) {
    console.log(JSON.stringify({ udid, ...parsed }));
  } else if (parsed.verb === "open-url") {
    console.log(`🔗 opened ${parsed.url} on ${udid}`);
  } else if (parsed.verb === "keychain-reset") {
    console.log(`🔑 reset keychain on ${udid}`);
  } else {
    console.log(`📲 pushed notification to ${parsed.bundleId} on ${udid}`);
  }
  process.exit(0);
}
