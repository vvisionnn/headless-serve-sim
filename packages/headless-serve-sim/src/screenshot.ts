import { execFileSync } from "child_process";
import { resolve } from "path";
import { findBootedDevice, resolveDevice } from "./device";

// ─── Argument parsing ───
//
// `screenshot [path] [--type <png|jpeg|tiff|bmp>] [--display <internal|external>]
//             [--mask <ignored|alpha|black>] [-d <udid|name>] [-q]`
//
// Single-action verb (no sub-verbs). Captures the simulator display to a PNG (or
// the chosen --type) via `xcrun simctl io <udid> screenshot`. At most ONE
// positional is allowed (the output path); when omitted the ENTRY generates a
// timestamped default filename — the parser stays deterministic (no Date.now).

export const SCREENSHOT_TYPES = ["png", "jpeg", "tiff", "bmp"] as const;
export const SCREENSHOT_DISPLAYS = ["internal", "external"] as const;
export const SCREENSHOT_MASKS = ["ignored", "alpha", "black"] as const;

export type ScreenshotType = (typeof SCREENSHOT_TYPES)[number];
export type ScreenshotDisplay = (typeof SCREENSHOT_DISPLAYS)[number];
export type ScreenshotMask = (typeof SCREENSHOT_MASKS)[number];

export interface ParsedScreenshot {
  path?: string;
  type: ScreenshotType;
  display?: ScreenshotDisplay;
  mask?: ScreenshotMask;
  device?: string;
  quiet: boolean;
}

function isType(v: string): v is ScreenshotType {
  return (SCREENSHOT_TYPES as readonly string[]).includes(v);
}
function isDisplay(v: string): v is ScreenshotDisplay {
  return (SCREENSHOT_DISPLAYS as readonly string[]).includes(v);
}
function isMask(v: string): v is ScreenshotMask {
  return (SCREENSHOT_MASKS as readonly string[]).includes(v);
}

export function parseScreenshotArgs(
  args: string[],
): ParsedScreenshot | { error: string } {
  let device: string | undefined;
  let type: ScreenshotType = "png";
  let display: ScreenshotDisplay | undefined;
  let mask: ScreenshotMask | undefined;
  let quiet = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--device") {
      device = args[++i];
      if (device === undefined) return { error: "Missing value for -d/--device" };
    } else if (a === "-q" || a === "--quiet") {
      quiet = true;
    } else if (a.startsWith("-") && a !== "-") {
      // Split a possible `--flag=value` form.
      const eq = a.indexOf("=");
      const flag = eq >= 0 ? a.slice(0, eq) : a;
      let value: string | undefined;
      if (eq >= 0) {
        value = a.slice(eq + 1);
      } else if (flag === "--type" || flag === "--display" || flag === "--mask") {
        value = args[++i];
        if (value === undefined) return { error: `Missing value for ${flag}` };
      }
      if (flag === "--type") {
        if (value === undefined || !isType(value)) {
          return { error: `Invalid --type "${value}". Allowed: ${SCREENSHOT_TYPES.join(", ")}` };
        }
        type = value;
      } else if (flag === "--display") {
        if (value === undefined || !isDisplay(value)) {
          return { error: `Invalid --display "${value}". Allowed: ${SCREENSHOT_DISPLAYS.join(", ")}` };
        }
        display = value;
      } else if (flag === "--mask") {
        if (value === undefined || !isMask(value)) {
          return { error: `Invalid --mask "${value}". Allowed: ${SCREENSHOT_MASKS.join(", ")}` };
        }
        mask = value;
      } else {
        return { error: `Unknown flag: ${flag}` };
      }
    } else {
      positional.push(a);
    }
  }

  if (positional.length > 1) {
    return { error: `Unexpected argument: ${positional[1]} (did you forget -d before a device name?)` };
  }

  return { path: positional[0], type, display, mask, device, quiet };
}

// ─── Command entry ───

// Map an image --type onto the on-disk extension for the default filename so
// `file` and downstream tools agree with the bytes simctl writes.
function extForType(type: ScreenshotType): string {
  return type === "jpeg" ? "jpg" : type;
}

export async function screenshot(args: string[]): Promise<void> {
  const parsed = parseScreenshotArgs(args);

  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(
      "\nUsage:\n" +
        "  headless-serve-sim screenshot [path] [--type <png|jpeg|tiff|bmp>]\n" +
        "                                [--display <internal|external>]\n" +
        "                                [--mask <ignored|alpha|black>] [-d <udid|name>]\n" +
        "\nCaptures the simulator display. Defaults to a PNG named\n" +
        "screenshot-<timestamp>.png in the current directory when no path is given.",
    );
    process.exit(1);
  }

  const udid = parsed.device ? resolveDevice(parsed.device) : findBootedDevice();
  if (!udid) {
    console.error("No booted simulator. Boot one or pass -d <udid|name>.");
    process.exit(1);
  }

  // Date.now lives here (not the parser) so the parser stays deterministic.
  const outPath = parsed.path
    ? resolve(parsed.path)
    : resolve(process.cwd(), `screenshot-${Date.now()}.${extForType(parsed.type)}`);

  // type is enum-validated; display/mask too. `outPath` is a discrete argv
  // element (no shell), so a path with spaces/quotes is safe without escaping.
  const argv = ["simctl", "io", udid, "screenshot", "--type", parsed.type];
  if (parsed.display) argv.push("--display", parsed.display);
  if (parsed.mask) argv.push("--mask", parsed.mask);
  argv.push(outPath);

  try {
    execFileSync("xcrun", argv, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    console.error(String(e?.stderr ?? e?.message ?? e).trim());
    process.exit(1);
  }

  if (parsed.quiet) {
    console.log(JSON.stringify({ udid, path: outPath, type: parsed.type }));
  } else {
    console.log(`📸 saved screenshot → ${outPath}`);
  }
  process.exit(0);
}
