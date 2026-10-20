#!/usr/bin/env bun
/**
 * Captures the real pixels the promo film shows: fresh simulators on Apple's
 * default wallpaper, the 9:41 status bar, the Lock Screen, Settings and its
 * accessibility tree, the iPad, iPhone Air and Apple Watch, and the iPhone Duo
 * in its poses as headless-serve-sim itself renders it. Also exports Simulator's
 * own device artwork for them. Everything lands in promo/assets/, which the
 * film reads, so rendering never needs a Mac — only re-capturing does.
 *
 *   mise run promo:capture            # macOS, Xcode, iOS and watchOS simulator runtimes
 *   bun run promo/scripts/capture.ts --keep       # leave the simulators booted afterwards
 *   bun run promo/scripts/capture.ts --duo-only   # only re-capture the iPhone Duo's fold
 *
 * It creates its own "hss-promo …" simulators and deletes them when done; it
 * never touches existing ones. Needs a built CLI (`bun run --cwd
 * packages/headless-serve-sim build`).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { loadInstalledDeviceFrameSpecAsync } from "../../../packages/headless-serve-sim/src/device-frame-profile";

const root = join(import.meta.dir, "..");
const repo = join(root, "../..");
const out = join(root, "assets");
const tmp = join(root, ".capture");
const HSS = join(repo, "packages/headless-serve-sim/dist/headless-serve-sim");
const keep = process.argv.includes("--keep");
/** Only the iPhone Duo's fold, for iterating on it. */
const duoOnly = process.argv.includes("--duo-only");
const FOLD_STEP = 5;

const TYPES = {
  phone: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  air: "com.apple.CoreSimulator.SimDeviceType.iPhone-Air",
  ipad: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB",
  duo: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo",
  watch: "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm",
} as const;
type Key = keyof typeof TYPES;

function run(bin: string, args: string[], opts: { quiet?: boolean } = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0 && !opts.quiet) throw new Error(`${bin} ${args.join(" ")}\n${r.stderr}`);
  return r.stdout.trim();
}
const simctl = (...args: string[]) => run("xcrun", ["simctl", ...args]);
const hss = (...args: string[]) => run(HSS, args);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The newest runtime that accepts this device type. */
function create(key: Key) {
  const runtimes = JSON.parse(simctl("list", "runtimes", "-j")).runtimes as {
    identifier: string;
    isAvailable: boolean;
    version: string;
  }[];
  const family = key === "watch" ? "watchOS" : "iOS";
  const candidates = runtimes
    .filter((r) => r.isAvailable && r.identifier.includes(`.${family}-`))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  for (const r of candidates) {
    const made = spawnSync(
      "xcrun",
      ["simctl", "create", `hss-promo ${key}`, TYPES[key], r.identifier],
      { encoding: "utf8" },
    );
    if (made.status === 0) return made.stdout.trim();
  }
  throw new Error(`no ${family} runtime can run ${TYPES[key]}`);
}

type AxNode = {
  type: string;
  AXLabel: string | null;
  frame: { x: number; y: number; width: number; height: number };
  children: AxNode[];
};
const flat = (n: AxNode): AxNode[] => [n, ...n.children.flatMap(flat)];
const ALERT = /^Allow .+\?$|would like to/;
const ACCEPT = ["Allow While Using App", "Allow", "OK"];

/**
 * Fresh simulators ask things on their own (the Maps widget asks for location
 * as soon as the Home Screen draws it). Accept every alert through the
 * device's own accessibility tree, and fail rather than capture one.
 */
function helperUrl(udid: string): string {
  const listed = JSON.parse(hss("--list", udid));
  return listed.streams?.[0]?.url ?? listed.url;
}

async function clearAlerts(udid: string) {
  const helper = helperUrl(udid);
  for (let i = 0; i < 8; i++) {
    const [app] = (await (await fetch(`${helper}/ax`)).json()) as AxNode[];
    const nodes = flat(app!);
    if (!nodes.some((n) => n.type === "StaticText" && ALERT.test(n.AXLabel ?? ""))) return;
    const button = ACCEPT.map((label) =>
      nodes.find((n) => n.type === "Button" && n.AXLabel === label),
    ).find(Boolean);
    if (!button) throw new Error(`an alert with no button to accept on ${udid}`);
    const { x, y, width, height } = button.frame;
    hss(
      "tap",
      String((x + width / 2) / app!.frame.width),
      String((y + height / 2) / app!.frame.height),
      "-d",
      udid,
    );
    await wait(2000);
  }
  throw new Error(`alerts kept coming on ${udid}`);
}

/**
 * 9:41 for the status bar override. The Lock Screen names the weekday of an
 * overridden date as if the year were 2023, so this picks the month nearest
 * today whose day falls on today's weekday in 2023: the Lock Screen then agrees
 * with the widgets, which run on the real clock.
 */
function nineFortyOne() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  for (const d of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, 6]) {
    const month = (now.getMonth() + d + 12) % 12;
    const day = new Date(2023, month, now.getDate());
    if (day.getMonth() === month && day.getDay() === now.getDay())
      return `2023-${pad(month + 1)}-${pad(now.getDate())}T09:41:00.000${zone}`;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T09:41:00.000${zone}`;
}

/** Shoots once the screen has stopped changing, so no widget is caught mid-load. */
async function shot(udid: string, name: string, format: "jpeg" | "png" = "jpeg") {
  const png = join(tmp, `${name}.png`);
  let last = "";
  for (let i = 0; i < 12; i++) {
    simctl("io", udid, "screenshot", "--type=png", png);
    const hash = Bun.hash(await Bun.file(png).arrayBuffer()).toString();
    if (hash === last) break;
    last = hash;
    await wait(2500);
  }
  if (format === "png") return run("cp", [png, join(out, `${name}.png`)]);
  run("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "90",
    png,
    "--out",
    join(out, `${name}.jpg`),
  ]);
}

mkdirSync(out, { recursive: true });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
if (!existsSync(HSS)) throw new Error(`build the CLI first: ${HSS} is missing`);

// Simulator's own device artwork, as the shipped bezel draws it.
const frames: Record<string, unknown> = {};
for (const [key, id] of Object.entries({
  iphone: TYPES.phone,
  air: TYPES.air,
  ipad: TYPES.ipad,
  watch: TYPES.watch,
})) {
  frames[key] = await loadInstalledDeviceFrameSpecAsync(id);
  if (!frames[key]) throw new Error(`no device frame for ${id}`);
}
writeFileSync(join(out, "device-frames.js"), `window.PROMO_FRAMES = ${JSON.stringify(frames)};\n`);

const sims = Object.fromEntries(
  (duoOnly ? (["duo"] as Key[]) : (Object.keys(TYPES) as Key[])).map((k) => [k, create(k)]),
) as Record<Key, string>;
console.log("created", sims);
/** The iPhone, Air, iPad and Watch screens. */
async function stills() {
  for (const key of ["phone", "air", "ipad", "watch"] as const) hss("--detach", "-q", sims[key]);
  const { phone, air, ipad, watch } = sims;

  // First boot finishes indexing and fills its widgets; Maps refreshes its own.
  const homes = ["phone", "air", "ipad"] as const;
  for (const key of homes) simctl("launch", sims[key], "com.apple.Maps");
  await wait(20_000);
  for (const key of homes) simctl("terminate", sims[key], "com.apple.Maps");
  await wait(5000);
  // Answering the widgets' location prompt reloads them, so answer it early and
  // give the widgets (and the status bar's location arrow) time to settle.
  for (const key of homes) await clearAlerts(sims[key]);
  await wait(60_000);

  // iPhone 17 Pro: Lock Screen, Home Screen light and dark, Settings with its tree.
  hss("button", "lock", "-d", phone);
  await wait(1500);
  hss("button", "lock", "-d", phone);
  await wait(2500);
  await shot(phone, "phone-lock");
  hss("button", "home", "-d", phone);
  await wait(2500);
  await clearAlerts(phone);
  await shot(phone, "phone-home-light");
  simctl("ui", phone, "appearance", "dark");
  await wait(2500);
  await clearAlerts(phone);
  await shot(phone, "phone-home-dark");
  simctl("launch", phone, "com.apple.Preferences");
  await wait(4000);
  await clearAlerts(phone);
  await shot(phone, "phone-settings-dark");
  writeFileSync(
    join(out, "phone-settings-ax.json"),
    await (await fetch(`${helperUrl(phone)}/ax`)).text(),
  );

  await clearAlerts(air);
  await shot(air, "air-home-dark");
  await clearAlerts(ipad);
  await shot(ipad, "ipad-home-light");
  hss("button", "home", "-d", watch);
  await wait(8000);
  await shot(watch, "watch-apps");
}

let server: ChildProcess | undefined;
try {
  for (const udid of Object.values(sims)) simctl("boot", udid);
  for (const udid of Object.values(sims)) simctl("bootstatus", udid, "-b");
  // watchOS has no status bar override, so the watch is shot on its app grid instead.
  for (const [key, udid] of Object.entries(sims)) {
    if (key === "watch") continue;
    simctl(
      "status_bar",
      udid,
      "override",
      "--time",
      nineFortyOne(),
      "--dataNetwork",
      "wifi",
      "--wifiMode",
      "active",
      "--wifiBars",
      "3",
      "--cellularMode",
      "active",
      "--cellularBars",
      "4",
      "--batteryState",
      "charged",
      "--batteryLevel",
      "100",
      "--operatorName",
      "",
    );
    simctl("location", udid, "set", "37.3349,-122.0090");
    // Granted up front, so Maps refreshes its widget without leaving a prompt on screen.
    simctl("privacy", udid, "grant", "location", "com.apple.Maps");
  }
  // Changing appearance reloads every widget, so the Air and the Duo go dark
  // before they first draw. (The Duo's light Screen Time widget reads as a
  // blank white card at the size the film shows it.)
  for (const key of ["air", "duo"] as const)
    if (sims[key]) simctl("ui", sims[key], "appearance", "dark");
  if (!duoOnly) await stills();

  // iPhone Duo: its fold as the Stage's own 3D renderer draws it. The hinge
  // moves physically, so each angle gets time to settle.
  server = spawn(HSS, [sims.duo], { stdio: ["ignore", "pipe", "inherit"] });
  const local = await new Promise<string>((resolve) =>
    server!.stdout!.on("data", (d: Buffer) => {
      const url = /Local:\s+(\S+)/.exec(d.toString())?.[1];
      if (url) resolve(url);
    }),
  );
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  // The Stage crops the Duo's canvas to the device at every angle. Note where
  // each crop sits in the stream, so the film can hold the hinge still.
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...a: unknown[]
    ) {
      if (a.length === 9)
        (this.canvas as HTMLCanvasElement & { crop?: number[] }).crop = [
          a[1],
          a[2],
          a[3],
          a[4],
        ] as number[];
      return (draw as (...x: unknown[]) => void).apply(this, a);
    } as typeof draw;
  });
  await page.goto(local);
  const grab = async () => {
    for (let i = 0; i < 80; i++) {
      const got = await page.evaluate(() => {
        const c = [...document.querySelectorAll("canvas")].find((c) => c.width > 200) as
          | (HTMLCanvasElement & { crop?: number[] })
          | undefined;
        return c?.crop ? { url: c.toDataURL("image/png"), crop: c.crop } : null;
      });
      if (got) return { png: Buffer.from(got.url.split(",")[1]!, "base64"), crop: got.crop };
      await wait(250);
    }
    throw new Error("the Duo never drew");
  };
  /** The next grab once the hinge has stopped and every widget has drawn. */
  const settled = async () => {
    let last = 0n;
    for (let still = 0, i = 0; i < 60; i++) {
      const shot = await grab();
      const hash = BigInt(Bun.hash(shot.png));
      still = hash === last ? still + 1 : 0;
      if (still >= 2) return shot;
      last = hash;
      await wait(2000);
    }
    throw new Error("the Duo never settled");
  };
  await grab();
  await clearAlerts(sims.duo);
  // The inner display draws its widgets only once it is open, so open it first.
  hss("motion", "angle", "180", "-d", sims.duo);
  await settled();
  // The fold, every few degrees, as the real hinge renders it. It is swept from
  // open to closed so the inner display's widgets stay drawn; the film plays it
  // backwards to open the Duo.
  const fold = join(out, "duo-fold");
  rmSync(fold, { recursive: true, force: true });
  mkdirSync(fold);
  const angles: { angle: number; crop: number[] }[] = [];
  for (let angle = 180; angle >= 0; angle -= FOLD_STEP) {
    hss("motion", "angle", String(angle), "-d", sims.duo);
    const { png, crop } = await settled();
    const name = String(angle).padStart(3, "0");
    writeFileSync(join(tmp, `${name}.png`), png);
    run("cwebp", [
      "-quiet",
      "-q",
      "90",
      "-alpha_q",
      "100",
      join(tmp, `${name}.png`),
      "-o",
      join(fold, `${name}.webp`),
    ]);
    angles.unshift({ angle, crop });
  }
  writeFileSync(
    join(fold, "fold.json"),
    `${JSON.stringify({ step: FOLD_STEP, frames: angles })}\n`,
  );
  await browser.close();
} finally {
  server?.kill();
  for (const udid of Object.values(sims)) run(HSS, ["--kill", udid], { quiet: true });
  if (!keep) {
    for (const udid of Object.values(sims)) {
      run("xcrun", ["simctl", "shutdown", udid], { quiet: true });
      run("xcrun", ["simctl", "delete", udid], { quiet: true });
    }
  }
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`captured into ${out}`);
