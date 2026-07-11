export type DeviceFrameFamily = "iphone" | "ipad" | "watch";
export type DeviceFrameCutout = "none" | "notch" | "dynamic-island";

export interface DeviceFrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DeviceFrameArtworkAsset {
  pngDataUrl: string;
  width: number;
  height: number;
}

export type DeviceFrameControlAnchor = "left" | "right" | "top" | "bottom";
export type DeviceFrameControlAlignment = "leading" | "center" | "trailing";

export interface DeviceFrameArtworkControl {
  name: string;
  image: DeviceFrameArtworkAsset;
  onTop: boolean;
  anchor: DeviceFrameControlAnchor;
  align: DeviceFrameControlAlignment;
  normalOffsetPx: { x: number; y: number };
  rolloverOffsetPx: { x: number; y: number };
}

export interface DeviceFrameArtwork {
  width: number;
  height: number;
  chromeRectPx: { x: number; y: number; width: number; height: number };
  slices: {
    topLeft: DeviceFrameArtworkAsset;
    top: DeviceFrameArtworkAsset;
    topRight: DeviceFrameArtworkAsset;
    right: DeviceFrameArtworkAsset;
    bottomRight: DeviceFrameArtworkAsset;
    bottom: DeviceFrameArtworkAsset;
    bottomLeft: DeviceFrameArtworkAsset;
    left: DeviceFrameArtworkAsset;
  };
  controls: DeviceFrameArtworkControl[];
}

export interface DeviceFrameSpec {
  deviceTypeIdentifier: string;
  modelName: string;
  family: DeviceFrameFamily;
  nativeScreen: { width: number; height: number };
  insetsPx: DeviceFrameInsets;
  screenRadiiPx: {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  };
  outerRadiiPx: { x: number; y: number };
  outerInsetsPx?: DeviceFrameInsets;
  cutout: DeviceFrameCutout;
  cutoutRectPx?: { x: number; y: number; width: number; height: number } | null;
  chromeIdentifier: string;
  artwork?: DeviceFrameArtwork;
}

export interface DeviceFrameIdentity {
  deviceTypeIdentifier?: string | null;
  modelName?: string | null;
  family?: DeviceFrameFamily | null;
}

export interface DeviceFrameMatch {
  spec: DeviceFrameSpec | null;
  matchedBy: "identifier" | "name" | "geometry" | "none";
}

function portraitDimensions(screen: { width: number; height: number }) {
  return screen.width <= screen.height
    ? screen
    : { width: screen.height, height: screen.width };
}

export function matchDeviceFrameSpec(
  identity: DeviceFrameIdentity,
  screen: { width: number; height: number },
  specs: readonly DeviceFrameSpec[],
): DeviceFrameMatch {
  if (identity.deviceTypeIdentifier) {
    const exact = specs.find(
      (spec) => spec.deviceTypeIdentifier === identity.deviceTypeIdentifier,
    );
    if (exact) return { spec: exact, matchedBy: "identifier" };
  }

  const requestedName = identity.modelName?.trim().toLocaleLowerCase();
  if (requestedName) {
    const exact = specs.find(
      (spec) => spec.modelName.toLocaleLowerCase() === requestedName,
    );
    if (exact) return { spec: exact, matchedBy: "name" };
  }

  if (!identity.family || screen.width <= 0 || screen.height <= 0) {
    return { spec: null, matchedBy: "none" };
  }
  const requested = portraitDimensions(screen);
  const familySpecs = specs.filter((spec) => spec.family === identity.family);
  const exactGeometry = familySpecs.filter((spec) => {
    const native = portraitDimensions(spec.nativeScreen);
    return native.width === requested.width && native.height === requested.height;
  });
  if (exactGeometry.length === 1) {
    return { spec: exactGeometry[0]!, matchedBy: "geometry" };
  }
  if (exactGeometry.length > 1) return { spec: null, matchedBy: "none" };

  const requestedAspect = requested.width / requested.height;
  const ranked = familySpecs
    .map((spec) => {
      const native = portraitDimensions(spec.nativeScreen);
      return {
        spec,
        error: Math.abs(native.width / native.height - requestedAspect),
      };
    })
    .sort((a, b) => a.error - b.error);
  const best = ranked[0];
  const next = ranked[1];
  if (
    best &&
    best.error <= 0.01 &&
    (!next || next.error - best.error > 1e-6)
  ) {
    return { spec: best.spec, matchedBy: "geometry" };
  }
  return { spec: null, matchedBy: "none" };
}
