import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { useAvccStream } from "../simulator/use-avcc-stream";
import { AvccDemuxer } from "../avcc-codec";

test("presents decoded frames without throttling a 120 Hz display opportunity", async () => {
  let effect!: React.EffectCallback;
  const effects = spyOn(React, "useEffect").mockImplementation((next) => {
    effect = next;
  });
  let handle!: Parameters<AvccDemuxer["visit"]>[1];
  const demux = spyOn(AvccDemuxer.prototype, "visit").mockImplementation((_data, next) => {
    handle = next;
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let decoder!: VideoDecoderInit;
  let now = 0,
    painted = 0;
  let progressed!: () => void;
  const received = new Promise<void>((resolve) => {
    progressed = resolve;
  });
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  try {
    replace(
      "VideoDecoder",
      class {
        state = "unconfigured";
        decodeQueueSize = 0;
        constructor(init: VideoDecoderInit) {
          decoder = init;
        }
        configure() {
          this.state = "configured";
        }
        decode() {}
        close() {
          this.state = "closed";
        }
      },
    );
    replace("EncodedVideoChunk", class {});
    replace("performance", { now: () => now });
    replace("requestAnimationFrame", () => 1);
    replace("cancelAnimationFrame", () => {});
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
      onProgress: progressed,
      canvasRef: {
        current: {
          width: 1280,
          height: 900,
          getContext: () => ({
            drawImage() {
              painted++;
            },
          }),
        } as unknown as HTMLCanvasElement,
      },
    });
    cleanup = effect();
    await received;
    handle("description", new Uint8Array([1, 0x64, 0, 0x28]));
    for (const time of [0, 1000 / 120, 1000 / 60]) {
      now = time;
      handle(time === 0 ? "keyframe" : "delta", new Uint8Array([1]));
      decoder.output({ displayWidth: 1280, displayHeight: 900, close() {} } as VideoFrame);
    }
    expect(painted).toBe(3);
    handle("metadata", new TextEncoder().encode(JSON.stringify({ includeFrame: true })));
    for (const time of [25, 29, 39]) {
      now = time;
      handle("delta", new Uint8Array([1]));
      decoder.output({ displayWidth: 3420, displayHeight: 3420, close() {} } as VideoFrame);
    }
    expect(painted).toBe(6);
  } finally {
    if (typeof cleanup === "function") cleanup();
    effects.mockRestore();
    demux.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
