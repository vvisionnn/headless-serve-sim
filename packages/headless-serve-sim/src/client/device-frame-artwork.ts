import type {
  DeviceFrameArtwork,
  DeviceFrameArtworkAsset,
  DeviceFrameArtworkControl,
  DeviceFrameSpec,
} from "headless-serve-sim-client/simulator";

export interface DeviceFrameArtworkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreparedDeviceFrameArtwork {
  source: CanvasImageSource;
  width: number;
  height: number;
  deviceTypeIdentifier: string;
  chromeIdentifier: string;
}

export interface DeviceFrameArtworkPlatform {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(dataUrl: string): Promise<CanvasImageSource>;
}

function restingOffset(control: DeviceFrameArtworkControl) {
  if (control.anchor === "left") return control.rolloverOffsetPx;
  return {
    x: 2 * control.normalOffsetPx.x - control.rolloverOffsetPx.x,
    y: 2 * control.normalOffsetPx.y - control.rolloverOffsetPx.y,
  };
}

export function deviceFrameControlRect(
  control: DeviceFrameArtworkControl,
  artwork: DeviceFrameArtwork,
): DeviceFrameArtworkRect {
  const chrome = artwork.chromeRectPx;
  const image = control.image;
  const offset = restingOffset(control);
  if (control.anchor === "left") {
    return {
      x: chrome.x + offset.x - image.width / 2,
      y: chrome.y + offset.y,
      width: image.width,
      height: image.height,
    };
  }
  if (control.anchor === "right") {
    return {
      x: chrome.x + chrome.width + offset.x,
      y: chrome.y + offset.y,
      width: image.width,
      height: image.height,
    };
  }

  const x = control.align === "leading"
    ? chrome.x + offset.x
    : control.align === "trailing"
      ? chrome.x + chrome.width + offset.x - image.width
      : chrome.x + chrome.width / 2 + offset.x - image.width / 2;
  return {
    x,
    y: control.anchor === "top"
      ? chrome.y + offset.y - image.height
      : chrome.y + chrome.height + offset.y,
    width: image.width,
    height: image.height,
  };
}

function bodyPath(
  context: CanvasRenderingContext2D,
  frame: DeviceFrameSpec,
): void {
  const artwork = frame.artwork!;
  const chrome = artwork.chromeRectPx;
  const insets = frame.outerInsetsPx ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const x = chrome.x + insets.left;
  const y = chrome.y + insets.top;
  const width = chrome.width - insets.left - insets.right;
  const height = chrome.height - insets.top - insets.bottom;
  const radiusX = Math.min(frame.outerRadiiPx.x, width / 2);
  const radiusY = Math.min(frame.outerRadiiPx.y, height / 2);
  const right = x + width;
  const bottom = y + height;

  context.beginPath();
  context.moveTo(x + radiusX, y);
  context.lineTo(right - radiusX, y);
  context.ellipse(right - radiusX, y + radiusY, radiusX, radiusY, 0, -Math.PI / 2, 0);
  context.lineTo(right, bottom - radiusY);
  context.ellipse(
    right - radiusX,
    bottom - radiusY,
    radiusX,
    radiusY,
    0,
    0,
    Math.PI / 2,
  );
  context.lineTo(x + radiusX, bottom);
  context.ellipse(
    x + radiusX,
    bottom - radiusY,
    radiusX,
    radiusY,
    0,
    Math.PI / 2,
    Math.PI,
  );
  context.lineTo(x, y + radiusY);
  context.ellipse(
    x + radiusX,
    y + radiusY,
    radiusX,
    radiusY,
    0,
    Math.PI,
    Math.PI * 1.5,
  );
  context.closePath();
}

function drawAsset(
  context: CanvasRenderingContext2D,
  images: ReadonlyMap<string, CanvasImageSource>,
  asset: DeviceFrameArtworkAsset,
  rect: DeviceFrameArtworkRect,
): void {
  context.drawImage(
    images.get(asset.pngDataUrl)!,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

export function paintDeviceFrameArtwork(
  context: CanvasRenderingContext2D,
  frame: DeviceFrameSpec,
  images: ReadonlyMap<string, CanvasImageSource>,
): boolean {
  const artwork = frame.artwork;
  if (!artwork) return false;
  const assets = [
    ...Object.values(artwork.slices),
    ...artwork.controls.map((control) => control.image),
  ];
  if (assets.some((asset) => !images.has(asset.pngDataUrl))) return false;

  for (const control of artwork.controls) {
    if (!control.onTop) {
      drawAsset(context, images, control.image, deviceFrameControlRect(control, artwork));
    }
  }

  context.fillStyle = "#09090b";
  bodyPath(context, frame);
  context.fill();

  const chrome = artwork.chromeRectPx;
  const slices = artwork.slices;
  const right = chrome.x + chrome.width;
  const bottom = chrome.y + chrome.height;
  drawAsset(context, images, slices.topLeft, {
    x: chrome.x,
    y: chrome.y,
    width: slices.topLeft.width,
    height: slices.topLeft.height,
  });
  drawAsset(context, images, slices.top, {
    x: chrome.x + slices.topLeft.width,
    y: chrome.y,
    width: Math.max(0, chrome.width - slices.topLeft.width - slices.topRight.width),
    height: slices.top.height,
  });
  drawAsset(context, images, slices.topRight, {
    x: right - slices.topRight.width,
    y: chrome.y,
    width: slices.topRight.width,
    height: slices.topRight.height,
  });
  drawAsset(context, images, slices.right, {
    x: right - slices.right.width,
    y: chrome.y + slices.topRight.height,
    width: slices.right.width,
    height: Math.max(0, chrome.height - slices.topRight.height - slices.bottomRight.height),
  });
  drawAsset(context, images, slices.bottomRight, {
    x: right - slices.bottomRight.width,
    y: bottom - slices.bottomRight.height,
    width: slices.bottomRight.width,
    height: slices.bottomRight.height,
  });
  drawAsset(context, images, slices.bottom, {
    x: chrome.x + slices.bottomLeft.width,
    y: bottom - slices.bottom.height,
    width: Math.max(0, chrome.width - slices.bottomLeft.width - slices.bottomRight.width),
    height: slices.bottom.height,
  });
  drawAsset(context, images, slices.bottomLeft, {
    x: chrome.x,
    y: bottom - slices.bottomLeft.height,
    width: slices.bottomLeft.width,
    height: slices.bottomLeft.height,
  });
  drawAsset(context, images, slices.left, {
    x: chrome.x,
    y: chrome.y + slices.topLeft.height,
    width: slices.left.width,
    height: Math.max(0, chrome.height - slices.topLeft.height - slices.bottomLeft.height),
  });

  for (const control of artwork.controls) {
    if (control.onTop) {
      drawAsset(context, images, control.image, deviceFrameControlRect(control, artwork));
    }
  }
  return true;
}

const browserArtworkPlatform: DeviceFrameArtworkPlatform = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("DeviceKit frame artwork could not be decoded"));
      image.src = dataUrl;
    });
  },
};

const preparedArtworkCache = new Map<string, Promise<PreparedDeviceFrameArtwork | null>>();
const MAX_PREPARED_ARTWORK_CACHE_ENTRIES = 2;

function preparationKey(frame: DeviceFrameSpec): string {
  const artwork = frame.artwork!;
  return [
    frame.deviceTypeIdentifier,
    frame.chromeIdentifier,
    artwork.width,
    artwork.height,
  ].join(":");
}

async function prepare(
  frame: DeviceFrameSpec,
  platform: DeviceFrameArtworkPlatform,
): Promise<PreparedDeviceFrameArtwork | null> {
  const artwork = frame.artwork;
  if (!artwork) return null;
  try {
    const assets = [
      ...Object.values(artwork.slices),
      ...artwork.controls.map((control) => control.image),
    ];
    const urls = [...new Set(assets.map((asset) => asset.pngDataUrl))];
    const loaded = await Promise.all(urls.map(async (url) => [
      url,
      await platform.loadImage(url),
    ] as const));
    const canvas = platform.createCanvas(artwork.width, artwork.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (!paintDeviceFrameArtwork(context, frame, new Map(loaded))) return null;
    return {
      source: canvas,
      width: artwork.width,
      height: artwork.height,
      deviceTypeIdentifier: frame.deviceTypeIdentifier,
      chromeIdentifier: frame.chromeIdentifier,
    };
  } catch {
    return null;
  }
}

export function prepareDeviceFrameArtwork(
  frame: DeviceFrameSpec,
  platform: DeviceFrameArtworkPlatform = browserArtworkPlatform,
): Promise<PreparedDeviceFrameArtwork | null> {
  if (platform !== browserArtworkPlatform) return prepare(frame, platform);
  if (!frame.artwork) return Promise.resolve(null);
  const key = preparationKey(frame);
  const cached = preparedArtworkCache.get(key);
  if (cached) return cached;
  const pending = prepare(frame, platform);
  preparedArtworkCache.set(key, pending);
  if (preparedArtworkCache.size > MAX_PREPARED_ARTWORK_CACHE_ENTRIES) {
    const oldestKey = preparedArtworkCache.keys().next().value;
    if (oldestKey !== undefined) preparedArtworkCache.delete(oldestKey);
  }
  void pending.then((prepared) => {
    if (!prepared && preparedArtworkCache.get(key) === pending) {
      preparedArtworkCache.delete(key);
    }
  });
  return pending;
}
