import { findBootedDevice, resolveDevice } from "./device";
import type { CommandChunk, HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";

// ─── Argument parsing ───
//
// `defaults read   <domain> [-d <udid|name>] [-q]`
// `defaults write  <domain> <key> --type <string|int|float|bool> <value> [-d] [-q]`
// `defaults delete <domain> <key> [-d <udid|name>] [-q]`
//
// Drives `xcrun simctl spawn <udid> defaults …` — the defaults tool runs INSIDE
// the simulator. `read` exports the domain as an XML plist and converts it to
// JSON on the host with `plutil`. Domain is a bundle id (standard prefs) OR a
// suite/group id; both share the reverse-dns-ish DOMAIN_RE shape.

export type DefaultsVerb = "read" | "write" | "delete";
export type DefaultsType = "string" | "int" | "float" | "bool";

export interface ParsedDefaults {
  verb: DefaultsVerb;
  domain: string;
  key?: string;
  type?: DefaultsType;
  value?: string;
  device?: string;
  quiet: boolean;
}

// Reverse-dns-ish: a bundle id or a suite/group id. Same shape as
// permissions.ts BUNDLE_ID_RE — no whitespace, quotes, or path traversal.
const DOMAIN_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
// A defaults key name: no whitespace, quotes, or control characters.
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

// --type flag -> the `defaults write` typed value flag.
const TYPE_BY_FLAG: Record<DefaultsType, string> = {
  string: "-string",
  int: "-int",
  float: "-float",
  bool: "-bool",
};
const DEFAULTS_TYPES = Object.keys(TYPE_BY_FLAG) as DefaultsType[];

export function parseDefaultsArgs(args: string[]): ParsedDefaults | { error: string } {
  let device: string | undefined;
  let type: DefaultsType | undefined;
  let quiet = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--device") {
      device = args[++i];
      if (device === undefined) return { error: "Missing value for -d/--device" };
    } else if (a === "--type") {
      const v = args[++i];
      if (v === undefined) return { error: "Missing value for --type" };
      if (!DEFAULTS_TYPES.includes(v as DefaultsType)) {
        return { error: `Invalid --type "${v}". Allowed: ${DEFAULTS_TYPES.join(", ")}` };
      }
      type = v as DefaultsType;
    } else if (a.startsWith("--type=")) {
      const v = a.slice("--type=".length);
      if (!DEFAULTS_TYPES.includes(v as DefaultsType)) {
        return { error: `Invalid --type "${v}". Allowed: ${DEFAULTS_TYPES.join(", ")}` };
      }
      type = v as DefaultsType;
    } else if (a === "-q" || a === "--quiet") {
      quiet = true;
    } else if (a.startsWith("-") && a !== "-") {
      return { error: `Unknown flag: ${a}` };
    } else {
      positional.push(a);
    }
  }

  const verbRaw = positional[0];
  if (!verbRaw) return { error: "Missing subcommand: read | write | delete" };
  if (verbRaw !== "read" && verbRaw !== "write" && verbRaw !== "delete") {
    return { error: `Unknown subcommand: ${verbRaw}` };
  }
  const verb: DefaultsVerb = verbRaw;

  const domain = positional[1];
  if (domain === undefined) return { error: `Missing domain for "${verb}"` };
  if (!DOMAIN_RE.test(domain)) return { error: `Invalid domain: ${domain}` };

  // Reject extra positionals rather than silently dropping them — an unquoted
  // device name or value would otherwise target the wrong device/value. Mirrors
  // parseStatusBarArgs' "did you forget -d" guard.
  const extra = (n: number) =>
    positional.length > n
      ? {
          error: `Unexpected argument: ${positional[n]} (did you forget -d before a device name, or quotes around a value?)`,
        }
      : null;

  if (verb === "read") {
    return extra(2) ?? { verb, domain, device, quiet };
  }

  const key = positional[2];
  if (key === undefined) return { error: `Missing key for "${verb}"` };
  if (!KEY_RE.test(key)) return { error: `Invalid key: ${key}` };

  if (verb === "delete") {
    return extra(3) ?? { verb, domain, key, device, quiet };
  }

  // verb === "write": needs --type and a value (trailing positional).
  if (type === undefined) {
    return { error: `Missing --type <${DEFAULTS_TYPES.join("|")}> for "write"` };
  }
  const value = positional[3];
  if (value === undefined) return { error: `Missing value for "write"` };

  return extra(4) ?? { verb, domain, key, type, value, device, quiet };
}

// ─── Command entry ───

const USAGE =
  "\nUsage:\n" +
  "  headless-serve-sim defaults read   <domain> [-d <udid|name>]\n" +
  "  headless-serve-sim defaults write  <domain> <key> --type <string|int|float|bool> <value> [-d <udid|name>]\n" +
  "  headless-serve-sim defaults delete <domain> <key> [-d <udid|name>]\n" +
  "\nDomain is a bundle id (standard prefs) or a suite/group id.";

export interface UserDefaultsModule {
  execute(udid: string, request: ParsedDefaults): Promise<string | null>;
}

/**
 * `plutil -convert json` rejects plist dates and data even though `defaults
 * export` emits both. Preserve their textual representation as JSON strings so
 * every valid defaults domain remains inspectable in the web UI.
 */
export function normalizeDefaultsPlistForJson(xml: Buffer): Buffer {
  return Buffer.from(
    xml
      .toString()
      .replace(/<date>([\s\S]*?)<\/date>/g, "<string>$1</string>")
      .replace(/<data>([\s\S]*?)<\/data>/g, (_match, value: string) => {
        return `<string>${value.replace(/\s+/g, "")}</string>`;
      }),
  );
}

export function createUserDefaults(host: HostCommands): UserDefaultsModule {
  const run = async (
    executable: string,
    args: readonly string[],
    input?: CommandChunk,
  ): Promise<Buffer> => {
    const result = await host.run({
      executable,
      args,
      ...(input === undefined ? {} : { input }),
      stdio: "capture",
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error(
        result.stderr.toString().trim() ||
          `Host command failed with exit code ${result.exitCode ?? "unknown"}`,
      );
    }
    return result.stdout;
  };

  return {
    async execute(udid, request) {
      if (request.verb === "read") {
        const xml = await run("xcrun", [
          "simctl",
          "spawn",
          udid,
          "defaults",
          "export",
          request.domain,
          "-",
        ]);
        const json = await run(
          "plutil",
          ["-convert", "json", "-o", "-", "-"],
          normalizeDefaultsPlistForJson(xml),
        );
        return json.toString().trim();
      }
      if (request.verb === "delete") {
        await run("xcrun", [
          "simctl",
          "spawn",
          udid,
          "defaults",
          "delete",
          request.domain,
          request.key!,
        ]);
        return null;
      }
      await run("xcrun", [
        "simctl",
        "spawn",
        udid,
        "defaults",
        "write",
        request.domain,
        request.key!,
        TYPE_BY_FLAG[request.type!],
        request.value!,
      ]);
      return null;
    },
  };
}

let productionDefaults: UserDefaultsModule | null = null;

function productionUserDefaults(): UserDefaultsModule {
  productionDefaults ??= createUserDefaults(createNodeHostCommands());
  return productionDefaults;
}

export async function userDefaults(args: string[]): Promise<void> {
  const quiet = args.includes("-q") || args.includes("--quiet");
  const rest = args.filter((a) => a !== "-q" && a !== "--quiet");
  const parsed = parseDefaultsArgs(rest);

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

  let output: string | null;
  try {
    output = await productionUserDefaults().execute(udid, parsed);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (parsed.verb === "read") {
    console.log(output);
    process.exit(0);
  }

  if (quiet) {
    console.log(JSON.stringify({ udid, ...parsed }));
  } else if (parsed.verb === "delete") {
    console.log(`⚙️  deleted ${parsed.key} from ${parsed.domain} on ${udid}`);
  } else {
    console.log(`⚙️  wrote ${parsed.key} to ${parsed.domain} on ${udid}`);
  }
  process.exit(0);
}
