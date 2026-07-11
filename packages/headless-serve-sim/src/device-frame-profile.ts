import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
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
  resolveArtworkAsset?: (
    name: string,
    scale: number,
  ) => DeviceFrameArtworkAsset | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
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
    paddingTop === null || paddingRight === null ||
    paddingBottom === null || paddingLeft === null
  ) return undefined;

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
      !input || typeof input.name !== "string" || typeof input.image !== "string" ||
      typeof input.onTop !== "boolean" ||
      !(["left", "right", "top", "bottom"] as const).includes(
        anchor as DeviceFrameControlAnchor,
      ) ||
      !(["leading", "center", "trailing"] as const).includes(
        align as DeviceFrameControlAlignment,
      ) ||
      !normalOffsetPx || !rolloverOffsetPx
    ) return undefined;
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
  if (
    typeof chromeIdentifier !== "string" ||
    chromeRoot.identifier !== chromeIdentifier
  ) return null;

  const displays = Array.isArray(capabilityRoot.displays)
    ? capabilityRoot.displays.map(record).filter((value) => value !== null)
    : [];
  const display = displays.find((value) => value.deviceName === "primary")
    ?? displays.find((value) => value.displayType === "integrated");
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
    left === null || right === null || top === null || bottom === null ||
    outerRadiusX === null || outerRadiusY === null
  ) return null;

  const radius = (key: string) => (finite(display[key]) ?? 0) * scale;
  const cutout = family !== "iphone"
    ? "none"
    : capabilityRoot.DeviceSupportsDynamicIsland === true
      ? "dynamic-island"
      : typeof profileRoot.sensorBarImage === "string"
        ? "notch"
        : "none";
  const cutoutRectPx = cutout === "notch" && sensorBarSize
    ? {
        x: (width - sensorBarSize.width * scale) / 2,
        y: 0,
        width: sensorBarSize.width * scale,
        height: sensorBarSize.height * scale,
      }
    : null;
  const chromeWidth = (left + right) * scale + width;
  const chromeHeight = (top + bottom) * scale + height;
  const artwork = buildArtwork(
    chromeRoot,
    scale,
    chromeWidth,
    chromeHeight,
    resolveArtworkAsset,
  );

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
const installedSpecCache = new Map<string, {
  value: DeviceFrameSpec | null;
  expiresAt: number;
}>();
let installedDeviceTypesCache: {
  value: CoreSimulatorDeviceType[];
  expiresAt: number;
} | null = null;

function readPlistJson(path: string): unknown {
  return JSON.parse(execFileSync(
    "plutil",
    ["-convert", "json", "-o", "-", path],
    { encoding: "utf8", timeout: 3_000 },
  ));
}

export function parsePdfMediaBoxSize(
  pdf: string,
): { width: number; height: number } | null {
  const match = pdf.match(
    /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/,
  );
  if (!match) return null;
  const width = Number(match[3]) - Number(match[1]);
  const height = Number(match[4]) - Number(match[2]);
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : null;
}

function readPdfMediaBox(path: string): { width: number; height: number } | null {
  return parsePdfMediaBoxSize(readFileSync(path, "latin1"));
}

function listInstalledDeviceTypes(): CoreSimulatorDeviceType[] {
  if (installedDeviceTypesCache && installedDeviceTypesCache.expiresAt > Date.now()) {
    return installedDeviceTypesCache.value;
  }
  try {
    const value = JSON.parse(execFileSync(
      "xcrun",
      ["simctl", "list", "devicetypes", "-j"],
      { encoding: "utf8", timeout: 3_000 },
    )) as { devicetypes?: unknown[] };
    const installedDeviceTypes = (value.devicetypes ?? []).flatMap((item) => {
      const value = record(item);
      return value &&
        typeof value.identifier === "string" &&
        typeof value.name === "string" &&
        typeof value.productFamily === "string" &&
        typeof value.bundlePath === "string"
        ? [{
            identifier: value.identifier,
            name: value.name,
            productFamily: value.productFamily,
            bundlePath: value.bundlePath,
          }]
        : [];
    });
    installedDeviceTypesCache = {
      value: installedDeviceTypes,
      expiresAt: Number.POSITIVE_INFINITY,
    };
  } catch {
    installedDeviceTypesCache = {
      value: [],
      expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
    };
  }
  return installedDeviceTypesCache.value;
}

/** Best-effort exact frame profile from the currently selected Xcode toolchain. */
export function loadInstalledDeviceFrameSpec(
  deviceTypeIdentifier: string,
): DeviceFrameSpec | null {
  const cached = installedSpecCache.get(deviceTypeIdentifier);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let resolved: DeviceFrameSpec | null = null;
  try {
    const deviceType = listInstalledDeviceTypes().find(
      (candidate) => candidate.identifier === deviceTypeIdentifier,
    );
    if (!deviceType) throw new Error("device type unavailable");
    const resources = join(deviceType.bundlePath, "Contents", "Resources");
    const capabilitiesPath = join(resources, "capabilities.plist");
    const profilePath = join(resources, "profile.plist");
    if (!existsSync(capabilitiesPath) || !existsSync(profilePath)) {
      throw new Error("device profile unavailable");
    }
    const capabilities = readPlistJson(capabilitiesPath);
    const profile = readPlistJson(profilePath);
    const profileRoot = record(profile);
    const chromeIdentifier = profileRoot?.chromeIdentifier;
    if (typeof chromeIdentifier !== "string") throw new Error("chrome unavailable");
    const chromeName = chromeIdentifier.replace(
      /^com\.apple\.dt\.devicekit\.chrome\./,
      "",
    );
    if (!/^[A-Za-z0-9._-]+$/.test(chromeName)) throw new Error("invalid chrome");
    const chromePath = join(
      "/Library/Developer/DeviceKit/Chrome",
      `${chromeName}.devicechrome`,
      "Contents",
      "Resources",
      "chrome.json",
    );
    if (!existsSync(chromePath)) throw new Error("chrome unavailable");
    const chromeResources = join(chromePath, "..");
    const sensorBarImage = profileRoot?.sensorBarImage;
    const sensorBarSize = typeof sensorBarImage === "string" &&
        /^[A-Za-z0-9._-]+$/.test(sensorBarImage)
      ? readPdfMediaBox(join(resources, `${sensorBarImage}.pdf`))
      : null;
    const tempDirectory = mkdtempSync(join(tmpdir(), "serve-sim-device-frame-"));
    try {
      const assets = new Map<string, DeviceFrameArtworkAsset | null>();
      const resolveArtworkAsset = (
        name: string,
        scale: number,
      ): DeviceFrameArtworkAsset | null => {
        const cachedAsset = assets.get(name);
        if (cachedAsset !== undefined) return cachedAsset;
        if (
          name.length === 0 || name.includes("/") || name.includes("\\") ||
          name.includes("\0")
        ) {
          assets.set(name, null);
          return null;
        }
        const pdfPath = join(chromeResources, `${name}.pdf`);
        const mediaBox = existsSync(pdfPath) ? readPdfMediaBox(pdfPath) : null;
        if (!mediaBox) {
          assets.set(name, null);
          return null;
        }
        const width = Math.max(1, Math.round(mediaBox.width * scale));
        const height = Math.max(1, Math.round(mediaBox.height * scale));
        const pngPath = join(tempDirectory, `asset-${assets.size}.png`);
        try {
          execFileSync(
            "/usr/bin/sips",
            [
              "-s", "format", "png",
              "-z", String(height), String(width),
              pdfPath,
              "--out", pngPath,
            ],
            { stdio: "ignore", timeout: 5_000 },
          );
          const asset = {
            pngDataUrl: `data:image/png;base64,${readFileSync(pngPath).toString("base64")}`,
            width,
            height,
          };
          assets.set(name, asset);
          return asset;
        } catch {
          assets.set(name, null);
          return null;
        }
      };
      resolved = buildDeviceFrameSpec({
        deviceType,
        capabilities,
        profile,
        chrome: JSON.parse(readFileSync(chromePath, "utf8")),
        sensorBarSize,
        resolveArtworkAsset,
      });
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  } catch {
    resolved = null;
  }
  installedSpecCache.set(deviceTypeIdentifier, {
    value: resolved,
    expiresAt: resolved?.artwork
      ? Number.POSITIVE_INFINITY
      : Date.now() + NEGATIVE_CACHE_TTL_MS,
  });
  return resolved;
}
