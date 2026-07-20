import { describe, expect, test } from "bun:test";
import type { DeviceFrameArtworkAsset, DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import {
  deviceFrameControlRect,
  paintDeviceFrameArtwork,
  prepareDeviceFrameArtwork,
} from "../client/device-frame-artwork";

function asset(name: string, width: number, height: number): DeviceFrameArtworkAsset {
  return { pngDataUrl: name, width, height };
}

const frame: DeviceFrameSpec = {
  deviceTypeIdentifier: "iphone-17-pro",
  modelName: "iPhone 17 Pro",
  family: "iphone",
  nativeScreen: { width: 1206, height: 2622 },
  insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
  screenRadiiPx: {
    topLeft: 186,
    topRight: 186,
    bottomRight: 186,
    bottomLeft: 186,
  },
  outerRadiiPx: { x: 240, y: 240 },
  cutout: "dynamic-island",
  chromeIdentifier: "phone11",
  artwork: {
    width: 1368,
    height: 2730,
    chromeRectPx: { x: 27, y: 0, width: 1314, height: 2730 },
    slices: {
      topLeft: asset("top-left", 330, 330),
      top: asset("top", 3, 330),
      topRight: asset("top-right", 330, 330),
      right: asset("right", 330, 3),
      bottomRight: asset("bottom-right", 330, 330),
      bottom: asset("bottom", 3, 330),
      bottomLeft: asset("bottom-left", 330, 330),
      left: asset("left", 330, 3),
    },
    controls: [
      {
        name: "action",
        image: asset("action", 48, 102),
        onTop: false,
        anchor: "left",
        align: "leading",
        normalOffsetPx: { x: 24, y: 480 },
        rolloverOffsetPx: { x: 9, y: 480 },
      },
      {
        name: "power",
        image: asset("power", 48, 303),
        onTop: true,
        anchor: "right",
        align: "leading",
        normalOffsetPx: { x: -24, y: 786 },
        rolloverOffsetPx: { x: -9, y: 786 },
      },
    ],
  },
};

class ArtworkContext {
  fillStyle = "";
  calls: Array<{ name: string; args: unknown[] }> = [];
  beginPath() {
    this.calls.push({ name: "beginPath", args: [] });
  }
  moveTo(...args: number[]) {
    this.calls.push({ name: "moveTo", args });
  }
  lineTo(...args: number[]) {
    this.calls.push({ name: "lineTo", args });
  }
  ellipse(...args: number[]) {
    this.calls.push({ name: "ellipse", args });
  }
  quadraticCurveTo(...args: number[]) {
    this.calls.push({ name: "quadraticCurveTo", args });
  }
  closePath() {
    this.calls.push({ name: "closePath", args: [] });
  }
  fill() {
    this.calls.push({ name: "fill", args: [] });
  }
  drawImage(...args: unknown[]) {
    this.calls.push({ name: "drawImage", args });
  }
}

describe("DeviceKit frame artwork", () => {
  test("places left and right controls at DeviceKit's resting offsets", () => {
    const artwork = frame.artwork!;

    expect(deviceFrameControlRect(artwork.controls[0]!, artwork)).toEqual({
      x: 12,
      y: 480,
      width: 48,
      height: 102,
    });
    expect(deviceFrameControlRect(artwork.controls[1]!, artwork)).toEqual({
      x: 1302,
      y: 786,
      width: 48,
      height: 303,
    });
  });

  test("honors trailing and center alignment for top and bottom controls", () => {
    const artwork = frame.artwork!;
    const base = artwork.controls[0]!;

    expect(
      deviceFrameControlRect(
        {
          ...base,
          anchor: "top",
          align: "trailing",
          image: asset("top-control", 60, 30),
          normalOffsetPx: { x: -15, y: 12 },
          rolloverOffsetPx: { x: -9, y: 6 },
        },
        artwork,
      ),
    ).toEqual({ x: 1260, y: -12, width: 60, height: 30 });
    expect(
      deviceFrameControlRect(
        {
          ...base,
          anchor: "bottom",
          align: "center",
          image: asset("bottom-control", 60, 30),
          normalOffsetPx: { x: 0, y: -12 },
          rolloverOffsetPx: { x: 0, y: -6 },
        },
        artwork,
      ),
    ).toEqual({ x: 654, y: 2712, width: 60, height: 30 });
  });

  test("nine-slices real metal around the body and respects control z-order", () => {
    const images = new Map<string, CanvasImageSource>();
    const assets = [
      ...Object.values(frame.artwork!.slices),
      ...frame.artwork!.controls.map((control) => control.image),
    ];
    for (const item of assets) images.set(item.pngDataUrl, { id: item.pngDataUrl } as never);
    const context = new ArtworkContext();

    expect(
      paintDeviceFrameArtwork(context as unknown as CanvasRenderingContext2D, frame, images),
    ).toBe(true);

    const draws = context.calls.filter((call) => call.name === "drawImage");
    expect(draws.map((draw) => (draw.args[0] as { id: string }).id)).toEqual([
      "action",
      "top-left",
      "top",
      "top-right",
      "right",
      "bottom-right",
      "bottom",
      "bottom-left",
      "left",
      "power",
    ]);
    expect(draws[1]!.args.slice(1)).toEqual([27, 0, 330, 330]);
    expect(draws[2]!.args.slice(1)).toEqual([357, 0, 654, 330]);
    expect(draws[4]!.args.slice(1)).toEqual([1011, 330, 330, 2070]);
  });

  test("preserves DeviceKit's transparent edge instead of filling a synthetic body", () => {
    const images = new Map<string, CanvasImageSource>();
    const assets = [
      ...Object.values(frame.artwork!.slices),
      ...frame.artwork!.controls.map((control) => control.image),
    ];
    for (const item of assets) images.set(item.pngDataUrl, { id: item.pngDataUrl } as never);
    const context = new ArtworkContext();

    expect(
      paintDeviceFrameArtwork(context as unknown as CanvasRenderingContext2D, frame, images),
    ).toBe(true);

    expect(context.calls.filter((call) => call.name === "fill")).toEqual([]);
  });

  test("decodes each vector raster once and prepares a native-size frame canvas", async () => {
    const context = new ArtworkContext();
    const loaded: string[] = [];
    const canvases: Array<{ width: number; height: number }> = [];
    const prepared = await prepareDeviceFrameArtwork(frame, {
      async loadImage(dataUrl) {
        loaded.push(dataUrl);
        return { id: dataUrl } as never;
      },
      createCanvas(width, height) {
        canvases.push({ width, height });
        return {
          width,
          height,
          getContext: () => context,
        } as unknown as HTMLCanvasElement;
      },
    });

    expect(new Set(loaded)).toEqual(
      new Set([
        "top-left",
        "top",
        "top-right",
        "right",
        "bottom-right",
        "bottom",
        "bottom-left",
        "left",
        "action",
        "power",
      ]),
    );
    expect(canvases).toEqual([{ width: 1368, height: 2730 }]);
    expect(prepared).toMatchObject({
      width: 1368,
      height: 2730,
      deviceTypeIdentifier: "iphone-17-pro",
      chromeIdentifier: "phone11",
    });
  });
});
