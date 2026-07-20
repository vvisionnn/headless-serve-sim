import { existsSync } from "fs";
import { join, resolve } from "path";
import { findBootedDevice, resolveDevice } from "./device";
import type { HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";
import { dirnameOf } from "./runtime";

// Bun's bundler inlines a bare `__dirname` as the build machine's source
// directory; shadow it with the runtime location so the published bundle
// finds dist/simax next to itself (same pattern as index.ts).
const __dirname = dirnameOf(import.meta.url);

// ─── Option catalogue ───
//
// Simulator-wide options surfaced in the sidebar, mirroring the Xcode Devices
// app. Three (`appearance`, `increase-contrast`, `text-size`) ride on
// `simctl ui`; the rest have no simctl verb, so they go through the
// sim-ax-settings helper spawned inside the simulator (see
// Sources/SimAXSettings), which drives the same private libAccessibility /
// MediaAccessibility setters the Devices app uses.

export const CONTENT_SIZE_CATEGORIES = [
  "extra-small",
  "small",
  "medium",
  "large",
  "extra-large",
  "extra-extra-large",
  "extra-extra-extra-large",
  "accessibility-medium",
  "accessibility-large",
  "accessibility-extra-large",
  "accessibility-extra-extra-large",
  "accessibility-extra-extra-extra-large",
] as const;

export const COLOR_FILTERS = [
  "none",
  "grayscale",
  "red-green",
  "green-red",
  "blue-yellow",
] as const;

const COLOR_FILTER_ALIASES: Record<string, string> = {
  protanopia: "red-green",
  deuteranopia: "green-red",
  tritanopia: "blue-yellow",
};

const TOGGLE_VALUES = ["on", "off"] as const;

const ON_SYNONYMS = new Set(["on", "true", "enabled", "1", "yes"]);
const OFF_SYNONYMS = new Set(["off", "false", "disabled", "0", "no"]);

interface UiOptionSpec {
  /** `simctl ui` subcommand, or "ax" for the in-sim helper. */
  via: "appearance" | "increase_contrast" | "content_size" | "ax";
  values: readonly string[];
  /** Extra accepted set-values that aren't reported by `get` (text-size). */
  extraValues?: readonly string[];
  aliases?: Record<string, string>;
  toggle?: boolean;
}

export const UI_OPTIONS = {
  appearance: { via: "appearance", values: ["light", "dark"] },
  "liquid-glass": { via: "ax", values: ["clear", "tinted"] },
  "color-filter": { via: "ax", values: COLOR_FILTERS, aliases: COLOR_FILTER_ALIASES },
  "text-size": {
    via: "content_size",
    values: CONTENT_SIZE_CATEGORIES,
    extraValues: ["increment", "decrement"],
  },
  "reduce-motion": { via: "ax", values: TOGGLE_VALUES, toggle: true },
  "increase-contrast": { via: "increase_contrast", values: TOGGLE_VALUES, toggle: true },
  "show-borders": { via: "ax", values: TOGGLE_VALUES, toggle: true },
  "reduce-transparency": { via: "ax", values: TOGGLE_VALUES, toggle: true },
  voiceover: { via: "ax", values: TOGGLE_VALUES, toggle: true },
} satisfies Record<string, UiOptionSpec>;

export type UiOption = keyof typeof UI_OPTIONS;

function uiOptionSpec(option: string): UiOptionSpec | undefined {
  return (UI_OPTIONS as Record<string, UiOptionSpec>)[option];
}

function isUiOption(option: string): option is UiOption {
  return uiOptionSpec(option) !== undefined;
}

/**
 * Map a user-supplied value onto its canonical form for the option, or null
 * when the value isn't valid. Toggles accept the usual on/off synonyms.
 */
export function normalizeUiValue(option: string, value: string): string | null {
  const spec = uiOptionSpec(option);
  if (!spec) return null;
  const v = value.toLowerCase();
  if (spec.toggle) {
    if (ON_SYNONYMS.has(v)) return "on";
    if (OFF_SYNONYMS.has(v)) return "off";
    return null;
  }
  const aliased = spec.aliases?.[v] ?? v;
  if (spec.values.includes(aliased)) return aliased;
  if (spec.extraValues?.includes(aliased)) return aliased;
  return null;
}

export interface UiArgs {
  command: "status" | "get" | "set";
  option?: string;
  value?: string;
  device?: string;
  json: boolean;
  error?: string;
}

export function parseUiArgs(args: string[]): UiArgs {
  const rest: string[] = [];
  let device: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-d" || a === "--device") {
      if (i + 1 >= args.length) {
        return { command: "get", json, error: `${a} requires a value` };
      }
      device = args[++i];
    } else if (a === "--json") json = true;
    else rest.push(a);
  }

  if (rest.length === 0 || rest[0] === "status") {
    return { command: "status", json, ...(device ? { device } : {}) };
  }

  const option = rest[0]!.toLowerCase();
  if (!isUiOption(option)) {
    return { command: "get", json, error: `unknown option: ${option}` };
  }
  if (rest.length === 1) {
    return { command: "get", option, json, ...(device ? { device } : {}) };
  }
  const value = normalizeUiValue(option, rest[1]!);
  if (value === null) {
    const spec = uiOptionSpec(option)!;
    const accepted = [...spec.values, ...(spec.extraValues ?? [])].join("|");
    return {
      command: "set",
      option,
      json,
      error: `invalid value for ${option}: ${rest[1]} (accepted: ${accepted})`,
    };
  }
  return { command: "set", option, value, json, ...(device ? { device } : {}) };
}

// ─── In-sim helper binary ───

export function locateAxSettingsTool(): string | null {
  const candidates = [
    join(__dirname, "..", "dist", "simax", "headless-serve-sim-ax-settings"),
    join(__dirname, "simax", "headless-serve-sim-ax-settings"),
  ];
  for (const p of candidates) if (existsSync(p)) return resolve(p);
  return null;
}

function toToggle(simctlValue: string): string {
  return simctlValue === "enabled" ? "on" : "off";
}

function fromToggle(value: string): string {
  return value === "on" ? "enabled" : "disabled";
}

interface UiSettingsModuleOptions {
  locateAxSettingsTool?: () => string | null;
  buildScript?: string;
  onBuild?: () => void;
}

export interface UiSettingsModule {
  get(udid: string, option: UiOption): Promise<string>;
  set(udid: string, option: UiOption, value: string): Promise<void>;
  status(udid: string): Promise<Record<string, string>>;
}

function commandOutput(result: Awaited<ReturnType<HostCommands["run"]>>): string {
  if (result.exitCode !== 0 || result.timedOut) {
    const detail = result.stderr.toString().trim();
    throw new Error(detail || `Host command failed with exit code ${result.exitCode ?? "unknown"}`);
  }
  return result.stdout.toString().trim();
}

/**
 * Typed domain Module for simulator-wide UI settings. The injected HostCommands
 * Adapter is the only Seam that can reach host tooling; callers and tests deal
 * exclusively in devices, options, and canonical values.
 */
export function createUiSettings(
  host: HostCommands,
  options: UiSettingsModuleOptions = {},
): UiSettingsModule {
  const locateTool = options.locateAxSettingsTool ?? locateAxSettingsTool;
  const buildScript =
    options.buildScript ?? join(__dirname, "..", "Sources", "SimAXSettings", "build.sh");
  let toolPromise: Promise<string> | null = null;

  const run = async (executable: string, args: readonly string[]): Promise<string> => {
    const result = await host.run({
      executable,
      args,
      stdio: "capture",
      maxOutputBytes: 4 * 1024 * 1024,
    });
    return commandOutput(result);
  };

  const axTool = (): Promise<string> => {
    toolPromise ??= (async () => {
      const located = locateTool();
      if (located) return located;
      if (!existsSync(buildScript)) {
        throw new Error(
          "sim-ax-settings binary not found — this build of headless-serve-sim does " +
            "not include the simulator settings helper. Reinstall from a recent release.",
        );
      }
      options.onBuild?.();
      await run("bash", [buildScript]);
      const built = locateTool();
      if (!built) throw new Error("Build succeeded but sim-ax-settings not found.");
      return built;
    })();
    toolPromise.catch(() => {
      toolPromise = null;
    });
    return toolPromise;
  };

  const simctlUi = (udid: string, subcommand: string, value?: string): Promise<string> => {
    const args = ["simctl", "ui", udid, subcommand];
    if (value !== undefined) args.push(value);
    return run("xcrun", args);
  };

  const axRun = async (udid: string, ...args: string[]): Promise<string> => {
    const tool = await axTool();
    return run("xcrun", ["simctl", "spawn", udid, tool, ...args]);
  };

  const get = async (udid: string, option: UiOption): Promise<string> => {
    const spec = uiOptionSpec(option);
    if (!spec) throw new Error(`unknown option: ${option}`);
    if (spec.via === "ax") return axRun(udid, "get", option);
    const raw = (await simctlUi(udid, spec.via)).toLowerCase();
    return spec.toggle ? toToggle(raw) : raw;
  };

  const set = async (udid: string, option: UiOption, value: string): Promise<void> => {
    const spec = uiOptionSpec(option);
    if (!spec) throw new Error(`unknown option: ${option}`);
    if (spec.via === "ax") {
      await axRun(udid, "set", option, value);
      return;
    }
    await simctlUi(udid, spec.via, spec.toggle ? fromToggle(value) : value);
  };

  const status = async (udid: string): Promise<Record<string, string>> => {
    const optionEntries = Object.entries(UI_OPTIONS) as Array<[UiOption, UiOptionSpec]>;
    const simctlOptions = optionEntries.filter(([, spec]) => spec.via !== "ax");
    const [axStatus, ...simctlValues] = await Promise.all([
      axRun(udid, "status").then((out) => JSON.parse(out) as Record<string, string>),
      ...simctlOptions.map(([option]) => get(udid, option)),
    ]);
    const result: Record<string, string> = {};
    for (const [option, spec] of optionEntries) {
      if (spec.via === "ax") result[option] = axStatus[option] ?? "unknown";
    }
    simctlOptions.forEach(([option], index) => {
      result[option] = simctlValues[index]!;
    });
    return result;
  };

  return { get, set, status };
}

let productionSettings: UiSettingsModule | null = null;

function productionUiSettings(): UiSettingsModule {
  productionSettings ??= createUiSettings(createNodeHostCommands(), {
    onBuild: () => {
      console.error("[headless-serve-sim] building sim-ax-settings (one-time)…");
    },
  });
  return productionSettings;
}

export async function getUiOption(udid: string, option: string): Promise<string> {
  if (!isUiOption(option)) throw new Error(`unknown option: ${option}`);
  return productionUiSettings().get(udid, option);
}

export async function setUiOption(udid: string, option: string, value: string): Promise<void> {
  if (!isUiOption(option)) throw new Error(`unknown option: ${option}`);
  return productionUiSettings().set(udid, option, value);
}

export async function getUiStatus(udid: string): Promise<Record<string, string>> {
  return productionUiSettings().status(udid);
}

// ─── CLI entry (`headless-serve-sim ui …`) ───

const USAGE = `Usage: headless-serve-sim ui [status] [--json] [-d udid]
       headless-serve-sim ui <option> [-d udid]          Print the current value
       headless-serve-sim ui <option> <value> [-d udid]  Change the value

Simulator-wide UI options:
  appearance           light | dark
  liquid-glass         clear | tinted
  color-filter         none | grayscale | red-green | green-red | blue-yellow
                       (protanopia/deuteranopia/tritanopia aliases accepted)
  text-size            ${CONTENT_SIZE_CATEGORIES.slice(0, 4).join(" | ")} | …
                       (12 content-size categories, or increment | decrement)
  reduce-motion        on | off
  increase-contrast    on | off
  show-borders         on | off
  reduce-transparency  on | off
  voiceover            on | off`;

export async function uiSettings(args: string[]): Promise<void> {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const parsed = parseUiArgs(args);
  if (parsed.error) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exit(1);
  }

  const udid = parsed.device ? resolveDevice(parsed.device) : findBootedDevice();
  if (!udid) {
    console.error("No booted simulator found. Boot one or pass -d <udid>.");
    process.exit(1);
  }

  if (parsed.command === "status") {
    const status = await getUiStatus(udid);
    if (parsed.json) {
      console.log(JSON.stringify(status));
    } else {
      for (const [option, value] of Object.entries(status)) {
        console.log(`${option.padEnd(20)} ${value}`);
      }
    }
    return;
  }

  if (parsed.command === "get") {
    console.log(await getUiOption(udid, parsed.option!));
    return;
  }

  await setUiOption(udid, parsed.option!, parsed.value!);
}
