import { findBootedDevice, resolveDevice } from "./device";
import type { HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";

// ─── Argument parsing ───
//
// `status-bar override [--time <v>] [--data-network <v>] [--wifi-bars <n>]
//                      [--wifi-mode <v>] [--cellular-bars <n>] [--cellular-mode <v>]
//                      [--operator-name <str>] [--battery-state <v>] [--battery-level <n>]
//                      [-d <udid|name>] [-q]`
// `status-bar clear [-d <udid|name>] [-q]`
//
// Maps kebab-case flags onto `xcrun simctl status_bar <udid> override` flags.
// The override sub-verb takes any non-empty subset of fields; clear takes none.

export interface StatusBarOverride {
  time?: string;
  dataNetwork?: string;
  wifiMode?: string;
  wifiBars?: number;
  cellularMode?: string;
  cellularBars?: number;
  operatorName?: string;
  batteryState?: string;
  batteryLevel?: number;
}

export type ParsedStatusBar =
  | { verb: "clear"; device?: string; quiet: boolean }
  | ({ verb: "override"; device?: string; quiet: boolean } & StatusBarOverride);

// Enum value sets, authoritative as of `xcrun simctl help status_bar` on this
// Xcode. `hide` is accepted by --dataNetwork alongside the named radio types.
export const DATA_NETWORK = [
  "hide",
  "wifi",
  "3g",
  "4g",
  "lte",
  "lte-a",
  "lte+",
  "5g",
  "5g+",
  "5g-uwb",
  "5g-uc",
] as const;
export const WIFI_MODE = ["searching", "failed", "active"] as const;
export const CELLULAR_MODE = ["notSupported", "searching", "failed", "active"] as const;
export const BATTERY_STATE = ["charging", "charged", "discharging"] as const;

// "9:41" or an ISO8601 timestamp (simctl also sets the date for a valid ISO string).
const TIME_RE = /^(\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}T[0-9:+\-Z.]+)$/;
const OPERATOR_RE = /^[\w .&'+-]{0,32}$/;
const NUM_RE = /^\d+$/;

// kebab flag -> { dest field, simctl flag, validator }. Numeric fields carry an
// inclusive [min,max] range; enum fields carry their allowed value list.
interface NumberFieldDef {
  kind: "number";
  field: "wifiBars" | "cellularBars" | "batteryLevel";
  simctl: string;
  min: number;
  max: number;
}
interface EnumFieldDef {
  kind: "enum";
  field: "dataNetwork" | "wifiMode" | "cellularMode" | "batteryState";
  simctl: string;
  values: readonly string[];
}
interface StringFieldDef {
  kind: "string";
  field: "time" | "operatorName";
  simctl: string;
  re: RegExp;
  label: string;
}
type FieldDef = NumberFieldDef | EnumFieldDef | StringFieldDef;

const FIELDS: Record<string, FieldDef> = {
  "--time": {
    kind: "string",
    field: "time",
    simctl: "--time",
    re: TIME_RE,
    label: '"9:41" or an ISO8601 timestamp',
  },
  "--data-network": {
    kind: "enum",
    field: "dataNetwork",
    simctl: "--dataNetwork",
    values: DATA_NETWORK,
  },
  "--wifi-mode": { kind: "enum", field: "wifiMode", simctl: "--wifiMode", values: WIFI_MODE },
  "--wifi-bars": { kind: "number", field: "wifiBars", simctl: "--wifiBars", min: 0, max: 3 },
  "--cellular-mode": {
    kind: "enum",
    field: "cellularMode",
    simctl: "--cellularMode",
    values: CELLULAR_MODE,
  },
  "--cellular-bars": {
    kind: "number",
    field: "cellularBars",
    simctl: "--cellularBars",
    min: 0,
    max: 4,
  },
  "--operator-name": {
    kind: "string",
    field: "operatorName",
    simctl: "--operatorName",
    re: OPERATOR_RE,
    label: "printable text up to 32 chars",
  },
  "--battery-state": {
    kind: "enum",
    field: "batteryState",
    simctl: "--batteryState",
    values: BATTERY_STATE,
  },
  "--battery-level": {
    kind: "number",
    field: "batteryLevel",
    simctl: "--batteryLevel",
    min: 0,
    max: 100,
  },
};

function validateField(def: FieldDef, raw: string): { error: string } | null {
  if (def.kind === "number") {
    if (!NUM_RE.test(raw)) {
      return { error: `Invalid ${def.simctl} "${raw}": expected an integer ${def.min}-${def.max}` };
    }
    const n = Number(raw);
    if (n < def.min || n > def.max) {
      return { error: `Invalid ${def.simctl} "${raw}": must be ${def.min}-${def.max}` };
    }
    return null;
  }
  if (def.kind === "enum") {
    if (!def.values.includes(raw)) {
      return { error: `Invalid ${def.simctl} "${raw}". Allowed: ${def.values.join(", ")}` };
    }
    return null;
  }
  if (!def.re.test(raw)) {
    return { error: `Invalid ${def.simctl} "${raw}": expected ${def.label}` };
  }
  return null;
}

export function parseStatusBarArgs(args: string[]): ParsedStatusBar | { error: string } {
  let device: string | undefined;
  let quiet = false;
  const override: StatusBarOverride = {};
  let sawField = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--device") {
      device = args[++i];
      if (device === undefined) return { error: "Missing value for -d/--device" };
      continue;
    }
    if (a === "-q" || a === "--quiet") {
      quiet = true;
      continue;
    }
    if (a.startsWith("-")) {
      // Split a possible `--flag=value` form.
      const eq = a.indexOf("=");
      const flag = eq >= 0 ? a.slice(0, eq) : a;
      const def = FIELDS[flag];
      if (!def) return { error: `Unknown flag: ${flag}` };
      let value: string | undefined;
      if (eq >= 0) {
        value = a.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next === undefined || (next.startsWith("-") && next !== "-")) {
          return { error: `Missing value for ${flag}` };
        }
        value = next;
        i++;
      }
      const invalid = validateField(def, value);
      if (invalid) return invalid;
      if (def.kind === "number") override[def.field] = Number(value);
      else override[def.field] = value;
      sawField = true;
      continue;
    }
    positional.push(a);
  }

  const verbRaw = positional[0];
  if (!verbRaw) return { error: "Missing subcommand: override | clear" };
  if (verbRaw !== "override" && verbRaw !== "clear") {
    return { error: `Unknown subcommand: ${verbRaw}` };
  }
  if (positional.length > 1) {
    return {
      error: `Unexpected argument: ${positional[1]} (did you forget -d before a device name?)`,
    };
  }

  if (verbRaw === "clear") {
    if (sawField) return { error: "`clear` takes no override flags" };
    return { verb: "clear", device, quiet };
  }

  if (!sawField) {
    return { error: "`override` needs at least one field (e.g. --time 9:41)" };
  }
  return { verb: "override", device, quiet, ...override };
}

// ─── Command entry ───

const OVERRIDE_FIELDS: ReadonlyArray<[keyof StatusBarOverride, string]> = [
  ["time", "--time"],
  ["dataNetwork", "--dataNetwork"],
  ["wifiMode", "--wifiMode"],
  ["wifiBars", "--wifiBars"],
  ["cellularMode", "--cellularMode"],
  ["cellularBars", "--cellularBars"],
  ["operatorName", "--operatorName"],
  ["batteryState", "--batteryState"],
  ["batteryLevel", "--batteryLevel"],
];

export interface StatusBarModule {
  apply(udid: string, request: ParsedStatusBar): Promise<void>;
}

export function createStatusBar(host: HostCommands): StatusBarModule {
  return {
    async apply(udid, request) {
      const args =
        request.verb === "clear"
          ? ["simctl", "status_bar", udid, "clear"]
          : (() => {
              const values = ["simctl", "status_bar", udid, "override"];
              for (const [field, flag] of OVERRIDE_FIELDS) {
                const value = request[field];
                if (value !== undefined) values.push(flag, String(value));
              }
              return values;
            })();
      const result = await host.run({
        executable: "xcrun",
        args,
        stdio: "capture",
      });
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(
          result.stderr.toString().trim() ||
            `Host command failed with exit code ${result.exitCode ?? "unknown"}`,
        );
      }
    },
  };
}

let productionStatusBar: StatusBarModule | null = null;

function productionStatusBarModule(): StatusBarModule {
  productionStatusBar ??= createStatusBar(createNodeHostCommands());
  return productionStatusBar;
}

export async function statusBar(args: string[]): Promise<void> {
  const quiet = args.includes("-q") || args.includes("--quiet");
  const rest = args.filter((a) => a !== "-q" && a !== "--quiet");
  const parsed = parseStatusBarArgs(rest);

  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(
      "\nUsage:\n" +
        "  headless-serve-sim status-bar override [flags] [-d <udid|name>]\n" +
        "  headless-serve-sim status-bar clear [-d <udid|name>]\n" +
        "\nOverride flags (any subset, at least one):\n" +
        "  --time <9:41|ISO8601>      --operator-name <str>\n" +
        `  --data-network <${DATA_NETWORK.join("|")}>\n` +
        `  --wifi-mode <${WIFI_MODE.join("|")}>          --wifi-bars <0-3>\n` +
        `  --cellular-mode <${CELLULAR_MODE.join("|")}>  --cellular-bars <0-4>\n` +
        `  --battery-state <${BATTERY_STATE.join("|")}>     --battery-level <0-100>`,
    );
    process.exit(1);
  }

  const udid = parsed.device ? resolveDevice(parsed.device) : findBootedDevice();
  if (!udid) {
    console.error("No booted simulator. Boot one or pass -d <udid|name>.");
    process.exit(1);
  }

  try {
    await productionStatusBarModule().apply(udid, parsed);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (quiet) {
    console.log(JSON.stringify({ udid, ...parsed }));
  } else if (parsed.verb === "clear") {
    console.log(`📶 cleared status bar overrides on ${udid}`);
  } else {
    console.log(`📶 status bar override applied on ${udid}`);
  }
  process.exit(0);
}
