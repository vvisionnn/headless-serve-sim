import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { useAvccStream } from "../simulator/use-avcc-stream";

test("a delayed JPEG seed never overwrites a newer decoded frame", async () => {
  const effects: React.EffectCallback[] = [];
  const effectSpy = spyOn(React, "useEffect").mockImplementation((effect) => effects.push(effect));
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replaceGlobal = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  let resolveSeed!: (bitmap: ImageBitmap) => void;
  let output!: (frame: VideoFrame) => void;
  const drawn: unknown[] = [];
  const dropped: number[] = [];
  let seedClosed = false;
  let resolveFrame!: () => void;
  const framePainted = new Promise<void>((resolve) => {
    resolveFrame = resolve;
  });
  const seed = { width: 10, height: 20, close: () => (seedClosed = true) } as ImageBitmap;
  const decoded = { displayWidth: 10, displayHeight: 20, close() {} } as VideoFrame;
  try {
    replaceGlobal(
      "VideoDecoder",
      class {
        state = "unconfigured";
        decodeQueueSize = 0;
        constructor(init: VideoDecoderInit) {
          output = init.output;
        }
        configure() {
          this.state = "configured";
        }
        decode() {
          queueMicrotask(() => output(decoded));
        }
        close() {
          this.state = "closed";
        }
      },
    );
    replaceGlobal("EncodedVideoChunk", class {});
    replaceGlobal(
      "createImageBitmap",
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolveSeed = resolve;
        }),
    );
    replaceGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // One network read contains configuration, seed, and the first IDR.
              controller.enqueue(
                new Uint8Array([
                  0, 0, 0, 5, 1, 1, 0x64, 0, 0x28, 0, 0, 0, 2, 4, 0xff, 0, 0, 0, 2, 2, 0xff,
                ]),
              );
            },
          }),
        ),
    );
    useAvccStream({
      url: "http://stream.test",
      enabled: true,
      onFrame: (info) => {
        dropped.push(info.dropped);
        resolveFrame();
      },
      canvasRef: {
        current: {
          width: 10,
          height: 20,
          getContext: () => ({ drawImage: (frame: unknown) => drawn.push(frame) }),
        } as unknown as HTMLCanvasElement,
      },
    });
    cleanup = effects[0]!();
    await framePainted;
    expect(drawn).toEqual([decoded]);
    resolveSeed(seed);
    await Promise.resolve();
    expect(drawn).toEqual([decoded]);
    expect(seedClosed).toBe(true);
    expect(dropped).toEqual([0]);
  } finally {
    if (typeof cleanup === "function") cleanup();
    effectSpy.mockRestore();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
