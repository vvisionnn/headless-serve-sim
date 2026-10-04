import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { useAvccStream, type AvccEncodedEvent } from "../simulator/use-avcc-stream";
import { AvccDemuxer } from "../avcc-codec";

test("coalesces large composition bursts without dropping encoded packets", async () => {
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
  let now = 0;
  const painted: number[] = [];
  const closed: number[] = [];
  const events: AvccEncodedEvent[] = [];
  const scheduled = new Map<number, FrameRequestCallback>();
  let nextHandle = 0;
  let progressed!: () => void;
  const received = new Promise<void>((resolve) => (progressed = resolve));
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
    replace("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduled.set(++nextHandle, callback);
      return nextHandle;
    });
    replace("cancelAnimationFrame", (id: number) => scheduled.delete(id));
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
      onEncoded: (event) => events.push(event),
      canvasRef: {
        current: {
          width: 3420,
          height: 3420,
          getContext: () => ({
            drawImage(source: { id: number }) {
              painted.push(source.id);
            },
          }),
        } as unknown as HTMLCanvasElement,
      },
    });
    cleanup = effect();
    await received;
    handle("description", new Uint8Array([1, 0x64, 0, 0x28]));
    handle("metadata", new TextEncoder().encode(JSON.stringify({ includeFrame: true })));
    const output = (id: number) => {
      const timing = new Uint8Array(24);
      const view = new DataView(timing.buffer);
      view.setBigUint64(0, BigInt(id * 16667));
      view.setBigUint64(8, 16667n);
      view.setBigUint64(16, BigInt(id));
      handle("timing", timing);
      handle(id === 1 ? "keyframe" : "delta", new Uint8Array([id]));
      decoder.output({
        id,
        displayWidth: 3420,
        displayHeight: 3420,
        close() {
          closed.push(id);
        },
      } as unknown as VideoFrame);
    };
    output(1);
    output(2);
    output(3);
    expect(painted).toEqual([1]);
    expect(closed).toEqual([1, 2]);
    expect(scheduled.size).toBe(1);
    now = 1000 / 60;
    scheduled.values().next().value?.(now);
    scheduled.clear();
    expect(painted).toEqual([1, 3]);
    expect(closed).toEqual([1, 2, 3]);
    expect(
      events.filter((event) => event.type === "picture").map((event) => event.sequence),
    ).toEqual([1, 2, 3]);
    for (const id of [4, 5, 6]) {
      now = ((id - 2) * 1000) / 60;
      output(id);
    }
    expect(painted).toEqual([1, 3, 4, 5, 6]);
    expect(scheduled.size).toBe(0);
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
    for (const time of [25.01, 33.35, 41.69]) {
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
