import { access, mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type {
  DeviceFrameArtwork,
  DeviceFrameArtworkAsset,
  DeviceFrameArtworkControl,
  DeviceFrameControlAlignment,
  DeviceFrameControlAnchor,
  DeviceFrameFamily,
  DeviceFrameSpec,
} from "headless-serve-sim-client/simulator";
import type { HostCommands } from "./runtime/host-commands";
import { createNodeHostCommands } from "./runtime/node-host-commands";

export interface CoreSimulatorDeviceType {
  identifier: string;
  name: string;
  productFamily: string;
  bundlePath: string;
}

export interface BuildDeviceFrameSpecInput {
  deviceType: CoreSimulatorDeviceType;
  capabilities: unknown;
  profile: unknown;
  chrome: unknown;
  sensorBarSize?: { width: number; height: number } | null;
  resolveArtworkAsset?: (name: string, scale: number) => DeviceFrameArtworkAsset | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function familyForProduct(productFamily: string): DeviceFrameFamily | null {
  if (productFamily === "iPhone") return "iphone";
  if (productFamily === "iPad") return "ipad";
  if (productFamily === "Apple Watch") return "watch";
  return null;
}

const SLICE_KEYS = [
  "topLeft",
  "top",
  "topRight",
  "right",
  "bottomRight",
  "bottom",
  "bottomLeft",
  "left",
] as const;

function assetNameIsSafe(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

function artworkPoint(value: unknown, scale: number): { x: number; y: number } | null {
  const point = record(value);
  const x = finite(point?.x);
  const y = finite(point?.y);
  return x === null || y === null ? null : { x: x * scale, y: y * scale };
}

function buildArtwork(
  chromeRoot: Record<string, unknown>,
  scale: number,
  chromeWidth: number,
  chromeHeight: number,
  resolveAsset: BuildDeviceFrameSpecInput["resolveArtworkAsset"],
): DeviceFrameArtwork | undefined {
  if (!resolveAsset) return undefined;
  const images = record(chromeRoot.images);
  const padding = record(images?.devicePadding);
  if (!images || !padding) return undefined;
  const paddingTop = finite(padding.top);
  const paddingRight = finite(padding.right);
  const paddingBottom = finite(padding.bottom);
  const paddingLeft = finite(padding.left);
  if (
    paddingTop === null ||
    paddingRight === null ||
    paddingBottom === null ||
    paddingLeft === null
  )
    return undefined;

  const slices = {} as DeviceFrameArtwork["slices"];
  for (const key of SLICE_KEYS) {
    const name = images[key];
    if (typeof name !== "string") return undefined;
    const asset = resolveAsset(name, scale);
    if (!asset) return undefined;
    slices[key] = asset;
  }

  const controls: DeviceFrameArtworkControl[] = [];
  const inputs = Array.isArray(chromeRoot.inputs) ? chromeRoot.inputs : [];
  for (const item of inputs) {
    const input = record(item);
    const offsets = record(input?.offsets);
    const normalOffsetPx = artworkPoint(offsets?.normal, scale);
    const rolloverOffsetPx = artworkPoint(offsets?.rollover, scale);
    const anchor = input?.anchor;
    const align = input?.align;
    if (
      !input ||
      typeof input.name !== "string" ||
      typeof input.image !== "string" ||
      typeof input.onTop !== "boolean" ||
      !(["left", "right", "top", "bottom"] as const).includes(anchor as DeviceFrameControlAnchor) ||
      !(["leading", "center", "trailing"] as const).includes(
        align as DeviceFrameControlAlignment,
      ) ||
      !normalOffsetPx ||
      !rolloverOffsetPx
    )
      return undefined;
    const image = resolveAsset(input.image, scale);
    if (!image) return undefined;
    controls.push({
      name: input.name,
      image,
      onTop: input.onTop,
      anchor: anchor as DeviceFrameControlAnchor,
      align: align as DeviceFrameControlAlignment,
      normalOffsetPx,
      rolloverOffsetPx,
    });
  }

  const chromeX = paddingLeft * scale;
  const chromeY = paddingTop * scale;
  return {
    width: chromeX + chromeWidth + paddingRight * scale,
    height: chromeY + chromeHeight + paddingBottom * scale,
    chromeRectPx: { x: chromeX, y: chromeY, width: chromeWidth, height: chromeHeight },
    slices,
    controls,
  };
}

export function buildDeviceFrameSpec({
  deviceType,
  capabilities,
  profile,
  chrome,
  sensorBarSize = null,
  resolveArtworkAsset,
}: BuildDeviceFrameSpecInput): DeviceFrameSpec | null {
  const family = familyForProduct(deviceType.productFamily);
  const capabilityRoot = record(record(capabilities)?.capabilities);
  const profileRoot = record(profile);
  const chromeRoot = record(chrome);
  if (!family || !capabilityRoot || !profileRoot || !chromeRoot) return null;

  const chromeIdentifier = profileRoot.chromeIdentifier;
  if (typeof chromeIdentifier !== "string" || chromeRoot.identifier !== chromeIdentifier)
    return null;

  const displays = Array.isArray(capabilityRoot.displays)
    ? capabilityRoot.displays.map(record).filter((value) => value !== null)
    : [];
  const display =
    displays.find((value) => value.deviceName === "primary") ??
    displays.find((value) => value.displayType === "integrated");
  const scale = finite(display?.scale);
  const width = finite(display?.width);
  const height = finite(display?.height);
  const sizing = record(record(chromeRoot.images)?.sizing);
  const outside = record(record(chromeRoot.paths)?.simpleOutsideBorder);
  if (!display || !scale || scale <= 0 || !width || !height || !sizing || !outside) {
    return null;
  }

  const left = finite(sizing.leftWidth);
  const right = finite(sizing.rightWidth);
  const top = finite(sizing.topHeight);
  const bottom = finite(sizing.bottomHeight);
  const outerRadiusX = finite(outside.cornerRadiusX);
  const outerRadiusY = finite(outside.cornerRadiusY);
  const outsideInsets = record(outside.insets);
  const outerInsetTop = finite(outsideInsets?.top) ?? 0;
  const outerInsetRight = finite(outsideInsets?.right) ?? 0;
  const outerInsetBottom = finite(outsideInsets?.bottom) ?? 0;
  const outerInsetLeft = finite(outsideInsets?.left) ?? 0;
  if (
    left === null ||
    right === null ||
    top === null ||
    bottom === null ||
    outerRadiusX === null ||
    outerRadiusY === null
  )
    return null;

  const radius = (key: string) => (finite(display[key]) ?? 0) * scale;
  const cutout =
    family !== "iphone"
      ? "none"
      : capabilityRoot.DeviceSupportsDynamicIsland === true
        ? "dynamic-island"
        : typeof profileRoot.sensorBarImage === "string"
          ? "notch"
          : "none";
  const cutoutRectPx =
    cutout === "notch" && sensorBarSize
      ? {
          x: (width - sensorBarSize.width * scale) / 2,
          y: 0,
          width: sensorBarSize.width * scale,
          height: sensorBarSize.height * scale,
        }
      : null;
  const chromeWidth = (left + right) * scale + width;
  const chromeHeight = (top + bottom) * scale + height;
  const artwork = buildArtwork(chromeRoot, scale, chromeWidth, chromeHeight, resolveArtworkAsset);

  return {
    deviceTypeIdentifier: deviceType.identifier,
    modelName: deviceType.name,
    family,
    nativeScreen: { width, height },
    insetsPx: {
      top: top * scale,
      right: right * scale,
      bottom: bottom * scale,
      left: left * scale,
    },
    screenRadiiPx: {
      topLeft: radius("cornerRadiusUL"),
      topRight: radius("cornerRadiusUR"),
      bottomRight: radius("cornerRadiusLR"),
      bottomLeft: radius("cornerRadiusLL"),
    },
    outerRadiiPx: {
      x: outerRadiusX * scale,
      y: outerRadiusY * scale,
    },
    outerInsetsPx: {
      top: outerInsetTop * scale,
      right: outerInsetRight * scale,
      bottom: outerInsetBottom * scale,
      left: outerInsetLeft * scale,
    },
    cutout,
    cutoutRectPx,
    chromeIdentifier,
    ...(artwork ? { artwork } : {}),
  };
}

const NEGATIVE_CACHE_TTL_MS = 5_000;

interface DeviceFrameProfileState {
  installedSpecCache: Map<
    string,
    {
      value: DeviceFrameSpec | null;
      expiresAt: number;
    }
  >;
  installedSpecLoads: Map<string, Promise<DeviceFrameSpec | null>>;
  installedDeviceTypesCache: {
    value: CoreSimulatorDeviceType[];
    expiresAt: number;
  } | null;
  installedDeviceTypesLoad: Promise<CoreSimulatorDeviceType[]> | null;
}

function createDeviceFrameProfileState(): DeviceFrameProfileState {
  return {
    installedSpecCache: new Map(),
    installedSpecLoads: new Map(),
    installedDeviceTypesCache: null,
    installedDeviceTypesLoad: null,
  };
}

async function hostOutput(
  host: HostCommands,
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const result = await host.run({ executable, args, timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `${executable} failed`);
  }
  return result.stdout.toString();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPlistJsonAsync(host: HostCommands, path: string): Promise<unknown> {
  return JSON.parse(await hostOutput(host, "plutil", ["-convert", "json", "-o", "-", path], 3_000));
}

export function parsePdfMediaBoxSize(pdf: string): { width: number; height: number } | null {
  const match = pdf.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (!match) return null;
  const width = Number(match[3]) - Number(match[1]);
  const height = Number(match[4]) - Number(match[2]);
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : null;
}

async function readPdfMediaBoxAsync(
  path: string,
): Promise<{ width: number; height: number } | null> {
  return parsePdfMediaBoxSize(await readFile(path, "latin1"));
}

function primaryDisplayScale(capabilities: unknown): number | null {
  const capabilityRoot = record(record(capabilities)?.capabilities);
  const displays = Array.isArray(capabilityRoot?.displays)
    ? capabilityRoot.displays.map(record).filter((value) => value !== null)
    : [];
  const display =
    displays.find((value) => value.deviceName === "primary") ??
    displays.find((value) => value.displayType === "integrated");
  const scale = finite(display?.scale);
  return scale && scale > 0 ? scale : null;
}

function artworkAssetNames(chrome: unknown): string[] {
  const chromeRoot = record(chrome);
  const images = record(chromeRoot?.images);
  const sliceNames = SLICE_KEYS.flatMap((key) => {
    const name = images?.[key];
    return typeof name === "string" ? [name] : [];
  });
  const controlNames = (Array.isArray(chromeRoot?.inputs) ? chromeRoot.inputs : []).flatMap(
    (item) => {
      const name = record(item)?.image;
      return typeof name === "string" ? [name] : [];
    },
  );
  return [...new Set([...sliceNames, ...controlNames])];
}

async function rasterizeArtworkAsset(
  host: HostCommands,
  name: string,
  scale: number,
  chromeResources: string,
  tempDirectory: string,
  index: number,
): Promise<DeviceFrameArtworkAsset | null> {
  if (!assetNameIsSafe(name)) return null;
  const pdfPath = join(chromeResources, `${name}.pdf`);
  if (!(await fileExists(pdfPath))) return null;
  let mediaBox: { width: number; height: number } | null;
  try {
    mediaBox = await readPdfMediaBoxAsync(pdfPath);
  } catch {
    return null;
  }
  if (!mediaBox) return null;
  const width = Math.max(1, Math.round(mediaBox.width * scale));
  const height = Math.max(1, Math.round(mediaBox.height * scale));
  const pngPath = join(tempDirectory, `asset-${index}.png`);
  try {
    await hostOutput(
      host,
      "/usr/bin/sips",
      ["-s", "format", "png", "-z", String(height), String(width), pdfPath, "--out", pngPath],
      5_000,
    );
    return {
      pngDataUrl: `data:image/png;base64,${(await readFile(pngPath)).toString("base64")}`,
      width,
      height,
    };
  } catch {
    return null;
  }
}

function parseInstalledDeviceTypes(value: unknown): CoreSimulatorDeviceType[] {
  const values = record(value)?.devicetypes;
  return (Array.isArray(values) ? values : []).flatMap((item) => {
    const deviceType = record(item);
    return deviceType &&
      typeof deviceType.identifier === "string" &&
      typeof deviceType.name === "string" &&
      typeof deviceType.productFamily === "string" &&
      typeof deviceType.bundlePath === "string"
      ? [
          {
            identifier: deviceType.identifier,
            name: deviceType.name,
            productFamily: deviceType.productFamily,
            bundlePath: deviceType.bundlePath,
          },
        ]
      : [];
  });
}

function cacheInstalledDeviceTypes(
  state: DeviceFrameProfileState,
  value: CoreSimulatorDeviceType[],
): CoreSimulatorDeviceType[] {
  state.installedDeviceTypesCache = {
    value,
    expiresAt: value.length > 0 ? Number.POSITIVE_INFINITY : Date.now() + NEGATIVE_CACHE_TTL_MS,
  };
  return value;
}

async function listInstalledDeviceTypesAsync(
  host: HostCommands,
  state: DeviceFrameProfileState,
): Promise<CoreSimulatorDeviceType[]> {
  if (state.installedDeviceTypesCache && state.installedDeviceTypesCache.expiresAt > Date.now()) {
    return state.installedDeviceTypesCache.value;
  }
  if (state.installedDeviceTypesLoad) return state.installedDeviceTypesLoad;
  const load = (async () => {
    try {
      return cacheInstalledDeviceTypes(
        state,
        parseInstalledDeviceTypes(
          JSON.parse(
            await hostOutput(host, "xcrun", ["simctl", "list", "devicetypes", "-j"], 3_000),
          ),
        ),
      );
    } catch {
      return cacheInstalledDeviceTypes(state, []);
    }
  })();
  state.installedDeviceTypesLoad = load;
  const clearLoad = () => {
    if (state.installedDeviceTypesLoad === load) state.installedDeviceTypesLoad = null;
  };
  void load.then(clearLoad, clearLoad);
  return load;
}

/**
 * Best-effort exact frame profile without blocking the Node event loop.
 *
 * DeviceKit artwork conversion invokes several command-line tools, so callers
 * serving HTTP requests must use this asynchronous variant.
 */
async function loadInstalledDeviceFrameSpecAsyncWithHost(
  host: HostCommands,
  state: DeviceFrameProfileState,
  deviceTypeIdentifier: string,
): Promise<DeviceFrameSpec | null> {
  const cached = state.installedSpecCache.get(deviceTypeIdentifier);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

  const inFlight = state.installedSpecLoads.get(deviceTypeIdentifier);
  if (inFlight) return inFlight;

  const load = (async (): Promise<DeviceFrameSpec | null> => {
    let resolved: DeviceFrameSpec | null = null;
    try {
      const deviceType = (await listInstalledDeviceTypesAsync(host, state)).find(
        (candidate) => candidate.identifier === deviceTypeIdentifier,
      );
      if (!deviceType) throw new Error("device type unavailable");
      const resources = join(deviceType.bundlePath, "Contents", "Resources");
      const capabilitiesPath = join(resources, "capabilities.plist");
      const profilePath = join(resources, "profile.plist");
      if (!(await fileExists(capabilitiesPath)) || !(await fileExists(profilePath))) {
        throw new Error("device profile unavailable");
      }
      const [capabilities, profile] = await Promise.all([
        readPlistJsonAsync(host, capabilitiesPath),
        readPlistJsonAsync(host, profilePath),
      ]);
      const profileRoot = record(profile);
      const chromeIdentifier = profileRoot?.chromeIdentifier;
      if (typeof chromeIdentifier !== "string") throw new Error("chrome unavailable");
      const chromeName = chromeIdentifier.replace(/^com\.apple\.dt\.devicekit\.chrome\./, "");
      if (!/^[A-Za-z0-9._-]+$/.test(chromeName)) throw new Error("invalid chrome");
      const chromePath = join(
        "/Library/Developer/DeviceKit/Chrome",
        `${chromeName}.devicechrome`,
        "Contents",
        "Resources",
        "chrome.json",
      );
      if (!(await fileExists(chromePath))) throw new Error("chrome unavailable");
      const chromeResources = join(chromePath, "..");
      const sensorBarImage = profileRoot?.sensorBarImage;
      const sensorBarPath =
        typeof sensorBarImage === "string" && assetNameIsSafe(sensorBarImage)
          ? join(resources, `${sensorBarImage}.pdf`)
          : null;
      let sensorBarSize: { width: number; height: number } | null = null;
      if (sensorBarPath && (await fileExists(sensorBarPath))) {
        try {
          sensorBarSize = await readPdfMediaBoxAsync(sensorBarPath);
        } catch {}
      }
      const chrome = JSON.parse(await readFile(chromePath, "utf8"));
      const scale = primaryDisplayScale(capabilities);
      const assets = new Map<string, DeviceFrameArtworkAsset | null>();
      const assetNames = artworkAssetNames(chrome);
      if (scale && assetNames.length > 0) {
        const tempDirectory = await mkdtemp(join(tmpdir(), "serve-sim-device-frame-"));
        try {
          for (const [index, name] of assetNames.entries()) {
            assets.set(
              name,
              await rasterizeArtworkAsset(host, name, scale, chromeResources, tempDirectory, index),
            );
          }
        } finally {
          await rm(tempDirectory, { force: true, recursive: true });
        }
      }
      resolved = buildDeviceFrameSpec({
        deviceType,
        capabilities,
        profile,
        chrome,
        sensorBarSize,
        resolveArtworkAsset: (name) => assets.get(name) ?? null,
      });
    } catch {
      resolved = null;
    }
    state.installedSpecCache.set(deviceTypeIdentifier, {
      value: resolved,
      expiresAt: resolved?.artwork ? Number.POSITIVE_INFINITY : Date.now() + NEGATIVE_CACHE_TTL_MS,
    });
    return resolved;
  })();
  state.installedSpecLoads.set(deviceTypeIdentifier, load);
  const clearLoad = () => {
    if (state.installedSpecLoads.get(deviceTypeIdentifier) === load) {
      state.installedSpecLoads.delete(deviceTypeIdentifier);
    }
  };
  void load.then(clearLoad, clearLoad);
  return load;
}

export interface DeviceFrameProfileLoader {
  load(deviceTypeIdentifier: string): Promise<DeviceFrameSpec | null>;
}

export function createDeviceFrameProfileLoader(host: HostCommands): DeviceFrameProfileLoader {
  const state = createDeviceFrameProfileState();
  return {
    load: (deviceTypeIdentifier) =>
      loadInstalledDeviceFrameSpecAsyncWithHost(host, state, deviceTypeIdentifier),
  };
}

const productionDeviceFrameProfileLoader = createDeviceFrameProfileLoader(createNodeHostCommands());

export function loadInstalledDeviceFrameSpecAsync(
  deviceTypeIdentifier: string,
): Promise<DeviceFrameSpec | null> {
  return productionDeviceFrameProfileLoader.load(deviceTypeIdentifier);
}
