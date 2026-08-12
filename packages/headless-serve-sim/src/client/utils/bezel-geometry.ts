import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";

export interface BezelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BezelCorners {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface BezelGeometry {
  /** Rendered size of the whole device, bezel included, after rotation. */
  width: number;
  height: number;
  /** Artwork px -> CSS px. */
  scale: number;
  /** Where the live screen sits inside that box, after rotation. */
  screen: BezelRect;
  /** Screen corner radii in CSS px, permuted to match the rotation. */
  screenRadii: BezelCorners;
  /** Outer radius in CSS px — only used when the profile ships no artwork. */
  outerRadius: number;
  /** Degrees to rotate the artwork image by. */
  rotation: number;
  /** Unrotated artwork bounds; the size the image is drawn at before rotating. */
  artworkWidth: number;
  artworkHeight: number;
}

/**
 * Rotate a rect inside its bounds. Mirrors the recorder's rotation so the live
 * view and a recording of it place the screen identically.
 */
function rotateRect(
  rect: BezelRect,
  boundsWidth: number,
  boundsHeight: number,
  degrees: number,
): BezelRect {
  if (degrees === 90) {
    return {
      x: boundsHeight - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }
  if (degrees === -90) {
    return {
      x: rect.y,
      y: boundsWidth - rect.x - rect.width,
      width: rect.height,
      height: rect.width,
    };
  }
  if (Math.abs(degrees) === 180) {
    return {
      x: boundsWidth - rect.x - rect.width,
      y: boundsHeight - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    };
  }
  return rect;
}

/**
 * Corners travel with the rotation: turn the device 90° clockwise and what was
 * the top-left corner is now the top-right. Every shipping device has four
 * equal radii, so this only matters if one ever doesn't — but then it matters a
 * lot, and it costs one array rotation.
 */
function rotateCorners(radii: BezelCorners, degrees: number): BezelCorners {
  const order = [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft];
  const steps = ((Math.round(degrees / 90) % 4) + 4) % 4;
  const [topLeft, topRight, bottomRight, bottomLeft] = [
    order[(0 - steps + 4) % 4]!,
    order[(1 - steps + 4) % 4]!,
    order[(2 - steps + 4) % 4]!,
    order[(3 - steps + 4) % 4]!,
  ];
  return { topLeft, topRight, bottomRight, bottomLeft };
}

/**
 * Fit a device — bezel and all — into the space available, preserving the
 * artwork's aspect ratio.
 *
 * The visible object is the whole device, not just its screen, so the fit is
 * driven by the artwork bounds; the screen size falls out of the resulting
 * scale. `maxScreenWidth` still caps the *screen* (that's what the device-type
 * cap is expressed in), which is why the cap is converted into a scale ceiling
 * rather than applied to the width directly.
 */
export function fitDeviceBezel(p: {
  spec: DeviceFrameSpec;
  /** Degrees the device is rotated by: 0, ±90 or 180. */
  rotation: number;
  availWidth: number;
  availHeight: number;
  maxScreenWidth: number;
  maxScale: number;
}): BezelGeometry {
  const { spec, rotation } = p;
  const insets = spec.insetsPx;
  const native = spec.nativeScreen;
  const chromeWidth = insets.left + native.width + insets.right;
  const chromeHeight = insets.top + native.height + insets.bottom;
  const chrome = spec.artwork?.chromeRectPx ?? {
    x: 0,
    y: 0,
    width: chromeWidth,
    height: chromeHeight,
  };
  // Artwork bounds are wider than the chrome: the side-button nubs stick out.
  const artworkWidth = spec.artwork?.width ?? chromeWidth;
  const artworkHeight = spec.artwork?.height ?? chromeHeight;

  const screen: BezelRect = {
    x: chrome.x + insets.left,
    y: chrome.y + insets.top,
    width: native.width,
    height: native.height,
  };
  const rotatedScreen = rotateRect(screen, artworkWidth, artworkHeight, rotation);
  const sideways = Math.abs(rotation) === 90;
  const boundsWidth = sideways ? artworkHeight : artworkWidth;
  const boundsHeight = sideways ? artworkWidth : artworkHeight;

  let scale = Math.min(
    p.availWidth / Math.max(1, boundsWidth),
    p.availHeight / Math.max(1, boundsHeight),
  );
  // The device-type cap is a screen-width cap; convert it to a scale ceiling.
  const screenCap = p.maxScreenWidth * p.maxScale;
  if (rotatedScreen.width > 0 && rotatedScreen.width * scale > screenCap) {
    scale = screenCap / rotatedScreen.width;
  }
  scale = Math.max(0, scale);

  return {
    width: boundsWidth * scale,
    height: boundsHeight * scale,
    scale,
    screen: {
      x: rotatedScreen.x * scale,
      y: rotatedScreen.y * scale,
      width: rotatedScreen.width * scale,
      height: rotatedScreen.height * scale,
    },
    screenRadii: (() => {
      const r = rotateCorners(spec.screenRadiiPx, rotation);
      return {
        topLeft: r.topLeft * scale,
        topRight: r.topRight * scale,
        bottomRight: r.bottomRight * scale,
        bottomLeft: r.bottomLeft * scale,
      };
    })(),
    outerRadius: Math.max(spec.outerRadiiPx.x, spec.outerRadiiPx.y) * scale,
    rotation,
    artworkWidth: artworkWidth * scale,
    artworkHeight: artworkHeight * scale,
  };
}
