import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { HostCommands } from "../runtime/host-commands";
import {
  buildDeviceFrameSpec,
  createDeviceFrameProfileLoader,
  parsePdfMediaBoxSize,
} from "../device-frame-profile";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const iphone17Pro = {
  identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  name: "iPhone 17 Pro",
  productFamily: "iPhone",
  bundlePath: "/DeviceTypes/iPhone 17 Pro.simdevicetype",
};

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: {
      DeviceSupportsDynamicIsland: true,
      displays: [
        {
          deviceName: "primary",
          displayType: "integrated",
          width: 1206,
          height: 2622,
          scale: 3,
          cornerRadiusUL: 62,
          cornerRadiusUR: 62,
          cornerRadiusLR: 62,
          cornerRadiusLL: 62,
        },
      ],
      ...overrides,
    },
  };
}

const chrome = {
  identifier: "com.apple.dt.devicekit.chrome.phone11",
  images: {
    sizing: { leftWidth: 18, rightWidth: 18, topHeight: 18, bottomHeight: 18 },
  },
  paths: {
    simpleOutsideBorder: {
      insets: { top: 1, right: 2, bottom: 3, left: 4 },
      cornerRadiusX: 80,
      cornerRadiusY: 80,
    },
  },
};

const realChrome = {
  ...chrome,
  images: {
    ...chrome.images,
    topLeft: "Phone TL",
    top: "Phone Top",
    topRight: "Phone TR",
    right: "Phone Right",
    bottomRight: "Phone BR",
    bottom: "Phone Base",
    bottomLeft: "Phone BL",
    left: "Phone Left",
    screen: "Screen",
    devicePadding: { top: 0, right: 9, bottom: 0, left: 9 },
  },
  inputs: [
    {
      name: "action",
      type: "button",
      image: "Mute BTN",
      onTop: false,
      anchor: "left",
      align: "leading",
      offsets: { normal: { x: 8, y: 160 }, rollover: { x: 3, y: 160 } },
    },
    {
      name: "power",
      type: "button",
      image: "X_Power BTN",
      onTop: false,
      anchor: "right",
      align: "leading",
      offsets: { normal: { x: -8, y: 262 }, rollover: { x: -3, y: 262 } },
    },
    {
      name: "volume-up",
      type: "button",
      image: "Volume BTN",
      onTop: false,
      anchor: "left",
      align: "leading",
      offsets: { normal: { x: 8, y: 221 }, rollover: { x: 3, y: 221 } },
    },
    {
      name: "volume-down",
      type: "button",
      image: "Volume BTN",
      onTop: false,
      anchor: "left",
      align: "leading",
      offsets: { normal: { x: 8, y: 300 }, rollover: { x: 3, y: 300 } },
    },
  ],
};

const duoCapabilities = capabilities({
  displays: [
    {
      screenID: 1,
      deviceName: "primary",
      displayType: "integrated",
      chromeIdentifier: "com.apple.dt.devicekit.chrome.phone15",
      framebufferMaskIdentifier: "cover-mask",
      width: 1398,
      height: 2034,
      scale: 3,
      cornerRadiusUL: 8,
      cornerRadiusUR: 59,
      cornerRadiusLR: 59,
      cornerRadiusLL: 8,
      nativeRotation: 0,
    },
    {
      screenID: 3,
      deviceName: "primary-1",
      displayType: "integrated",
      chromeIdentifier: "com.apple.dt.devicekit.chrome.phone14",
      framebufferMaskIdentifier: "inner-mask",
      width: 2007,
      height: 2853,
      scale: 3,
      cornerRadiusUL: 55,
      cornerRadiusUR: 55,
      cornerRadiusLR: 55,
      cornerRadiusLL: 55,
      nativeRotation: 270,
    },
  ],
});

const duoType = {
  ...iphone17Pro,
  identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo",
  name: "iPhone Duo",
};

const duoProfile = { chromeIdentifier: "com.apple.dt.devicekit.chrome.phone15" };

const innerChrome = {
  ...chrome,
  identifier: "com.apple.dt.devicekit.chrome.phone14",
  images: {
    ...realChrome.images,
    composite: "PhoneComposite",
    sizing: { leftWidth: 17, rightWidth: 17, topHeight: 17, bottomHeight: 17 },
    devicePadding: { top: 10, right: 10, bottom: 10, left: 10 },
  },
};

describe("buildDeviceFrameSpec", () => {
  test("selects the integrated display by screen ID and its own chrome", () => {
    expect(
      buildDeviceFrameSpec({
        deviceType: duoType,
        capabilities: duoCapabilities,
        profile: duoProfile,
        chrome: innerChrome,
        displayId: 3,
      }),
    ).toMatchObject({
      displayId: 3,
      deviceName: "primary-1",
      nativeRotation: 270,
      nativeScreen: { width: 2007, height: 2853 },
      screenRadiiPx: { topLeft: 165, topRight: 165, bottomRight: 165, bottomLeft: 165 },
      insetsPx: { top: 51, right: 51, bottom: 51, left: 51 },
      chromeIdentifier: "com.apple.dt.devicekit.chrome.phone14",
    });
  });

  test("does not synthesize a Dynamic Island from a device-wide capability for Duo", () => {
    expect(
      buildDeviceFrameSpec({
        deviceType: duoType,
        capabilities: duoCapabilities,
        profile: { ...duoProfile, sensorBarImage: "sensor_bar_class_04" },
        chrome: innerChrome,
        displayId: 3,
      }),
    ).toMatchObject({ cutout: "none", cutoutRectPx: null });
  });

  test("preserves an exact framebuffer mask without approximating its corner path", () => {
    const screenMask = { pngDataUrl: "exact-screen-mask", width: 1398, height: 2034 };
    const frame = buildDeviceFrameSpec({
      deviceType: duoType,
      capabilities: duoCapabilities,
      profile: duoProfile,
      chrome: { ...chrome, identifier: "com.apple.dt.devicekit.chrome.phone15" },
      screenMask,
    });

    expect(frame?.screenMask).toEqual(screenMask);
  });

  test("builds exact native-pixel geometry from CoreSimulator and DeviceKit", () => {
    expect(
      buildDeviceFrameSpec({
        deviceType: iphone17Pro,
        capabilities: capabilities(),
        profile: {
          chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
          sensorBarImage: "sensor_bar_class_04",
        },
        chrome,
      }),
    ).toEqual({
      deviceTypeIdentifier: iphone17Pro.identifier,
      modelName: "iPhone 17 Pro",
      family: "iphone",
      nativeScreen: { width: 1206, height: 2622 },
      insetsPx: { top: 54, right: 54, bottom: 54, left: 54 },
      screenRadiiPx: { topLeft: 186, topRight: 186, bottomRight: 186, bottomLeft: 186 },
      outerRadiiPx: { x: 240, y: 240 },
      outerInsetsPx: { top: 3, right: 6, bottom: 9, left: 12 },
      cutout: "dynamic-island",
      cutoutRectPx: null,
      chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11",
    });
  });

  test("uses notch metadata instead of drawing an Island on every iPhone", () => {
    expect(
      buildDeviceFrameSpec({
        deviceType: { ...iphone17Pro, identifier: "type.iphone-16e", name: "iPhone 16e" },
        capabilities: capabilities({ DeviceSupportsDynamicIsland: false }),
        profile: {
          chromeIdentifier: "com.apple.dt.devicekit.chrome.phone13",
          sensorBarImage: "sensor_bar_class_03",
        },
        sensorBarSize: { width: 176, height: 34 },
        chrome: { ...chrome, identifier: "com.apple.dt.devicekit.chrome.phone13" },
      }),
    ).toMatchObject({
      cutout: "notch",
      cutoutRectPx: { x: 339, y: 0, width: 528, height: 102 },
    });
  });

  test("loads modern composite chrome without its unused nine-slice placeholders", () => {
    const requested: string[] = [];
    const frame = buildDeviceFrameSpec({
      deviceType: duoType,
      capabilities: duoCapabilities,
      profile: duoProfile,
      chrome: innerChrome,
      displayId: 3,
      resolveArtworkAsset: (name, scale) => {
        requested.push(name);
        return name === "PhoneComposite"
          ? { pngDataUrl: "composite", width: 660 * scale, height: 924 * scale }
          : null;
      },
    });

    expect(frame?.artwork).toMatchObject({
      width: 2169,
      height: 3015,
      chromeRectPx: { x: 30, y: 30, width: 2109, height: 2955 },
      composite: { pngDataUrl: "composite", width: 1980, height: 2772 },
      controls: [],
    });
    expect(requested).toEqual(["PhoneComposite"]);
  });

  test("preserves real DeviceKit metal slices and physical-control geometry", () => {
    const mediaBoxes: Record<string, { width: number; height: number }> = {
      "Phone TL": { width: 110, height: 110 },
      "Phone Top": { width: 1, height: 110 },
      "Phone TR": { width: 110, height: 110 },
      "Phone Right": { width: 110, height: 1 },
      "Phone BR": { width: 110, height: 110 },
      "Phone Base": { width: 1, height: 110 },
      "Phone BL": { width: 110, height: 110 },
      "Phone Left": { width: 110, height: 1 },
      "Mute BTN": { width: 16, height: 34 },
      "X_Power BTN": { width: 16, height: 101 },
      "Volume BTN": { width: 16, height: 64 },
    };
    const frame = buildDeviceFrameSpec({
      deviceType: iphone17Pro,
      capabilities: capabilities(),
      profile: { chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11" },
      chrome: realChrome,
      resolveArtworkAsset: (name, scale) => {
        const size = mediaBoxes[name];
        return size
          ? {
              pngDataUrl: `data:image/png;base64,${name}`,
              width: size.width * scale,
              height: size.height * scale,
            }
          : null;
      },
    });

    expect(frame?.artwork).toMatchObject({
      width: 1368,
      height: 2730,
      chromeRectPx: { x: 27, y: 0, width: 1314, height: 2730 },
      slices: {
        topLeft: { width: 330, height: 330 },
        top: { width: 3, height: 330 },
        right: { width: 330, height: 3 },
      },
      controls: [
        {
          name: "action",
          anchor: "left",
          align: "leading",
          onTop: false,
          image: { width: 48, height: 102 },
          normalOffsetPx: { x: 24, y: 480 },
          rolloverOffsetPx: { x: 9, y: 480 },
        },
        {
          name: "power",
          anchor: "right",
          align: "leading",
          onTop: false,
          image: { width: 48, height: 303 },
          normalOffsetPx: { x: -24, y: 786 },
          rolloverOffsetPx: { x: -9, y: 786 },
        },
        {
          name: "volume-up",
          anchor: "left",
          image: { width: 48, height: 192 },
          normalOffsetPx: { x: 24, y: 663 },
          rolloverOffsetPx: { x: 9, y: 663 },
        },
        {
          name: "volume-down",
          anchor: "left",
          image: { width: 48, height: 192 },
          normalOffsetPx: { x: 24, y: 900 },
          rolloverOffsetPx: { x: 9, y: 900 },
        },
      ],
    });
  });

  test("keeps ordinary chrome nine-sliced even when it also advertises a composite", () => {
    const requested: string[] = [];
    const frame = buildDeviceFrameSpec({
      deviceType: iphone17Pro,
      capabilities: capabilities(),
      profile: { chromeIdentifier: realChrome.identifier },
      chrome: { ...realChrome, images: { ...realChrome.images, composite: "LegacyComposite" } },
      resolveArtworkAsset: (name) => {
        requested.push(name);
        return { pngDataUrl: name, width: 3, height: 3 };
      },
    });

    expect(frame?.artwork?.slices).toBeDefined();
    expect(frame?.artwork?.composite).toBeUndefined();
    expect(requested).not.toContain("LegacyComposite");
  });

  test("rejects incomplete artwork instead of silently dropping a hardware control", () => {
    const frame = buildDeviceFrameSpec({
      deviceType: iphone17Pro,
      capabilities: capabilities(),
      profile: { chromeIdentifier: "com.apple.dt.devicekit.chrome.phone11" },
      chrome: realChrome,
      resolveArtworkAsset: (name) =>
        name === "X_Power BTN" ? null : { pngDataUrl: name, width: 3, height: 3 },
    });

    expect(frame).not.toHaveProperty("artwork");
  });

  test("returns null rather than inventing a phone frame for unsupported profiles", () => {
    expect(
      buildDeviceFrameSpec({
        deviceType: { ...iphone17Pro, productFamily: "Apple Vision" },
        capabilities: capabilities(),
        profile: {},
        chrome: {},
      }),
    ).toBeNull();
  });
});

describe("parsePdfMediaBoxSize", () => {
  test("uses the displayed page dimensions for rotated DeviceKit control PDFs", () => {
    expect(parsePdfMediaBoxSize("/MediaBox [0 0 63 16] /Rotate 270")).toEqual({
      width: 16,
      height: 63,
    });
  });

  test("subtracts non-zero PDF origins from the upper-right coordinates", () => {
    expect(parsePdfMediaBoxSize("/MediaBox [ 12 -4 112 196 ]")).toEqual({
      width: 100,
      height: 200,
    });
  });
});

async function withInstalledDuo(
  run: (
    loader: ReturnType<typeof createDeviceFrameProfileLoader>,
    rasterized: string[],
  ) => Promise<void>,
  options: { failFirstMask?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "serve-sim-frame-fixture-"));
  try {
    const bundlePath = join(root, "Duo.simdevicetype");
    const resources = join(bundlePath, "Contents", "Resources");
    const chromeDirectory = join(root, "Chrome");
    const framebufferMaskDirectory = join(root, "FramebufferMasks");
    await mkdir(framebufferMaskDirectory);
    await writeFile(join(framebufferMaskDirectory, "cover-mask.pdf"), "/MediaBox [0 0 466 678]");
    await writeFile(join(framebufferMaskDirectory, "inner-mask.pdf"), "/MediaBox [0 0 1252 1780]");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "capabilities.plist"), JSON.stringify(duoCapabilities));
    await writeFile(join(resources, "profile.plist"), JSON.stringify(duoProfile));
    for (const [name, width, height] of [
      ["phone14", 660, 924],
      ["phone15", 514, 706],
    ] as const) {
      const chromeResources = join(
        chromeDirectory,
        `${name}.devicechrome`,
        "Contents",
        "Resources",
      );
      await mkdir(chromeResources, { recursive: true });
      await writeFile(
        join(chromeResources, "chrome.json"),
        JSON.stringify({
          ...innerChrome,
          identifier: `com.apple.dt.devicekit.chrome.${name}`,
          images: {
            ...innerChrome.images,
            ...(name === "phone15"
              ? {
                  sizing: { leftWidth: 26, rightWidth: 22, topHeight: 14, bottomHeight: 14 },
                }
              : {}),
          },
        }),
      );
      await writeFile(
        join(chromeResources, "PhoneComposite.pdf"),
        `/MediaBox [0 0 ${width} ${height}]`,
      );
    }
    const rasterized: string[] = [];
    let maskAttempts = 0;
    const host: HostCommands = {
      ...createScriptedHostCommands(),
      run: (async (request) => {
        if (!("executable" in request)) throw new Error("Unexpected shell command");
        const args = request.args ?? [];
        let stdout = "";
        if (request.executable === "xcrun") {
          stdout = JSON.stringify({ devicetypes: [{ ...duoType, bundlePath }] });
        } else if (request.executable === "plutil") {
          stdout = await readFile(args.at(-1)!, "utf8");
        } else if (request.executable === "/usr/bin/sips") {
          if (args[6]!.startsWith(framebufferMaskDirectory)) {
            if (options.failFirstMask && maskAttempts++ === 0)
              throw new Error("mask temporarily unavailable");
          } else {
            rasterized.push(args[6]!);
          }
          await writeFile(args.at(-1)!, "synthetic png");
        } else {
          throw new Error("Unexpected command");
        }
        return {
          exitCode: 0,
          signal: null,
          stdout: Buffer.from(stdout),
          stderr: Buffer.alloc(0),
          timedOut: false,
        };
      }) as HostCommands["run"],
    };
    await run(
      createDeviceFrameProfileLoader(host, { chromeDirectory, framebufferMaskDirectory }),
      rasterized,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("installed device frame profiles", () => {
  test("retries a failed framebuffer mask conversion despite having composite artwork", async () => {
    let now = 1_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      await withInstalledDuo(
        async (loader) => {
          const first = await loader.load(duoType.identifier, { displayId: 3 });
          expect(first?.artwork).toBeDefined();
          expect(first?.screenMask).toBeUndefined();
          now += 5_000;
          expect(
            (await loader.load(duoType.identifier, { displayId: 3 }))?.screenMask,
          ).toBeDefined();
        },
        { failFirstMask: true },
      );
    } finally {
      clock.mockRestore();
    }
  });

  test("rasterizes each display's framebuffer mask to native screen pixels", async () => {
    await withInstalledDuo(async (loader) => {
      const frames = await loader.loadAll(duoType.identifier);

      expect(frames.map((frame) => frame.screenMask)).toEqual([
        {
          pngDataUrl: `data:image/png;base64,${Buffer.from("synthetic png").toString("base64")}`,
          width: 1398,
          height: 2034,
        },
        {
          pngDataUrl: `data:image/png;base64,${Buffer.from("synthetic png").toString("base64")}`,
          width: 2007,
          height: 2853,
        },
      ]);
    });
  });

  test("loads one display's own composite rather than the primary profile chrome", async () => {
    await withInstalledDuo(async (loader, rasterized) => {
      const inner = await loader.load(duoType.identifier, { displayId: 3 });

      expect(inner).toMatchObject({ displayId: 3, nativeScreen: { width: 2007, height: 2853 } });
      expect(inner?.artwork?.composite).toMatchObject({ width: 1980, height: 2772 });
      expect(rasterized).toHaveLength(1);
      expect(rasterized[0]).toContain("phone14.devicechrome");
    });
  });

  test("collects all integrated display profiles and caches artwork separately", async () => {
    await withInstalledDuo(async (loader, rasterized) => {
      const frames = await loader.loadAll(duoType.identifier);

      expect(frames.map((frame) => frame.displayId)).toEqual([1, 3]);
      expect(frames.map((frame) => frame.artwork?.composite?.width)).toEqual([1542, 1980]);
      await loader.load(duoType.identifier, { displayId: 3 });
      expect(rasterized).toHaveLength(2);
    });
  });

  test("returns no display profiles when the installed device type is unavailable", async () => {
    const host = createScriptedHostCommands([
      { result: { stdout: JSON.stringify({ devicetypes: [] }) } },
    ]);
    const loader = createDeviceFrameProfileLoader(host);

    await expect(loader.loadAll("missing.device.type")).resolves.toEqual([]);
  });

  test("discovers device types through injected host commands", async () => {
    const host = createScriptedHostCommands([
      {
        result: { stdout: JSON.stringify({ devicetypes: [] }) },
      },
    ]);
    const loader = createDeviceFrameProfileLoader(host);

    await expect(loader.load("missing.device.type")).resolves.toBeNull();
    expect(host.calls[0]).toMatchObject({
      kind: "run",
      request: {
        executable: "xcrun",
        args: ["simctl", "list", "devicetypes", "-j"],
        timeoutMs: 3_000,
      },
    });
  });
});
