import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { useAvccStream, type AvccFrameInfo } from "../simulator/use-avcc-stream";
import { AvccDemuxer } from "../avcc-codec";
import type { SimulatorComposition } from "../types";

const composition: SimulatorComposition = {
  angle: 90,
  rotation: 0,
  scale: 1,
  displayId: 3,
  rawWidth: 2007,
  rawHeight: 2853,
  rawRotation: 90,
  mask: "M0 0Z",
  bounds: [0, 0, 1, 1],
  pieces: [],
};

function wire(tag: number, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(payload.length + 5);
  new DataView(output.buffer).setUint32(0, payload.length + 1);
  output[4] = tag;
  output.set(payload, 5);
  return output;
}

function seedJPEG(): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(composition));
  const length = bytes.length + 11;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xef,
    length >> 8,
    length & 0xff,
    ...new TextEncoder().encode("SSCM1"),
    0,
    0,
    0,
    1,
    ...bytes,
    0xff,
    0xd9,
  ]);
}

test("a JPEG seed from a closed connection cannot paint after reconnect", async () => {
  const effects: React.EffectCallback[] = [];
  const effectSpy = spyOn(React, "useEffect").mockImplementation((effect) => effects.push(effect));
  const visitor = spyOn(AvccDemuxer.prototype, "visit").mockImplementation((_bytes, handle) => {
    handleChunk = handle;
  });
  let handleChunk!: Parameters<AvccDemuxer["visit"]>[1];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  let decoderInit!: VideoDecoderInit;
  let resolveSeed!: (bitmap: ImageBitmap) => void;
  const painted: AvccFrameInfo[] = [];
  let received!: () => void;
  const requested = new Promise<void>((resolve) => {
    received = resolve;
  });
  try {
    replace(
      "VideoDecoder",
      class {
        state = "unconfigured";
        constructor(init: VideoDecoderInit) {
          decoderInit = init;
        }
        configure() {
          this.state = "configured";
        }
        close() {
          this.state = "closed";
        }
      },
    );
    replace("EncodedVideoChunk", class {});
    replace(
      "createImageBitmap",
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolveSeed = resolve;
        }),
    );
    replace(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
        ),
    );
    useAvccStream({
      url: "http://stream.test",
      enabled: true,
      canvasRef: {
        current: {
          width: 1280,
          height: 900,
          getContext: () => ({ drawImage() {} }),
        } as unknown as HTMLCanvasElement,
      },
      onFrame: (frame) => painted.push(frame),
      onProgress: received,
    });
    cleanup = effects[0]!();
    await requested;
    handleChunk("description", new Uint8Array([1, 0x64, 0, 0x28]));
    handleChunk("seed", seedJPEG());
    decoderInit.error(new DOMException("test fault"));
    resolveSeed({ width: 1280, height: 900, close() {} } as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(painted).toEqual([]);
  } finally {
    if (typeof cleanup === "function") cleanup();
    effectSpy.mockRestore();
    visitor.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("AVCC JPEG seed publishes its own metadata after bitmap decode, not later AVCC metadata", async () => {
  const effects: React.EffectCallback[] = [];
  const effectSpy = spyOn(React, "useEffect").mockImplementation((effect) => effects.push(effect));
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  let resolveSeed!: (bitmap: ImageBitmap) => void;
  let received!: () => void;
  const requested = new Promise<void>((resolve) => {
    received = resolve;
  });
  let info: AvccFrameInfo | undefined;
  try {
    replace("VideoDecoder", class {});
    replace("EncodedVideoChunk", class {});
    replace(
      "createImageBitmap",
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolveSeed = resolve;
          received();
        }),
    );
    replace(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(wire(4, seedJPEG()));
              controller.enqueue(
                wire(7, new TextEncoder().encode(JSON.stringify({ ...composition, displayId: 1 }))),
              );
            },
          }),
        ),
    );
    useAvccStream({
      url: "http://stream.test",
      enabled: true,
      canvasRef: {
        current: {
          width: 1280,
          height: 900,
          getContext: () => ({ drawImage() {} }),
        } as unknown as HTMLCanvasElement,
      },
      onFrame: (frame) => {
        info = frame;
      },
    });
    cleanup = effects[0]!();
    await requested;
    expect(info).toBeUndefined();
    resolveSeed({ width: 1280, height: 900, close() {} } as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(info?.composition).toEqual(composition);
  } finally {
    if (typeof cleanup === "function") cleanup();
    effectSpy.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
