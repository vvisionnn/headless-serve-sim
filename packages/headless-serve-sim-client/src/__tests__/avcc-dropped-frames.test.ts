import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { useAvccStream, type AvccFrameInfo } from "../simulator/use-avcc-stream";

test("accounts for skipped chunks and recovery work exactly once, excluding teardown", async () => {
  const effects: React.EffectCallback[] = [];
  const effectSpy = spyOn(React, "useEffect").mockImplementation((effect) => effects.push(effect));
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replaceGlobal = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const decoders: FakeDecoder[] = [];
  class FakeDecoder {
    state = "unconfigured";
    decodeQueueSize = 0;
    rejectNext = false;
    constructor(readonly callbacks: VideoDecoderInit) {
      decoders.push(this);
    }
    configure() {
      this.state = "configured";
    }
    decode() {
      if (this.rejectNext) throw new Error("rejected frame");
      this.decodeQueueSize++;
    }
    close() {
      this.state = "closed";
    }
    output() {
      const frame = {
        displayWidth: 10,
        displayHeight: 20,
        closed: 0,
        close() {
          this.closed++;
        },
      };
      this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
      this.callbacks.output(frame as unknown as VideoFrame);
      return frame;
    }
  }
  let now = 0;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let progressed: () => void = () => {};
  const frames: AvccFrameInfo[] = [];
  const presentations = new Map<number, () => void>();
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  const send = async (...tags: number[]) => {
    const received = new Promise<void>((resolve) => {
      progressed = resolve;
    });
    stream.enqueue(new Uint8Array(tags.flatMap((tag) => [0, 0, 0, 2, tag, 0xff])));
    await received;
  };
  try {
    replaceGlobal("VideoDecoder", FakeDecoder);
    replaceGlobal("EncodedVideoChunk", class {});
    replaceGlobal("performance", { now: () => now });
    replaceGlobal("requestAnimationFrame", (callback: () => void) => {
      presentations.set(1, callback);
      return 1;
    });
    replaceGlobal("cancelAnimationFrame", (handle: number) => presentations.delete(handle));
    replaceGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
        ),
    );
    useAvccStream({
      url: "http://stream.test",
      enabled: true,
      onFrame: (info) => frames.push(info),
      onProgress: () => progressed(),
      canvasRef: {
        current: {
          width: 10,
          height: 20,
          getContext: () => ({ drawImage() {} }),
        } as unknown as HTMLCanvasElement,
      },
    });
    cleanup = effects[0]!();

    await send(3, 1, 3, 6, 2); // no decoder, config, two deltas without IDR, IDR
    decoders[0]!.output();
    expect(frames.at(-1)?.dropped).toBe(3);

    await send(3, 3); // two submitted frames still waiting for output
    decoders[0]!.rejectNext = true;
    await send(3, 3, 6, 2); // rejected frame, two skipped deltas, recovery IDR
    const stale = decoders[0]!.output();
    expect(stale.closed).toBe(1); // already counted when its decoder was reset
    now = 20;
    decoders[1]!.output();
    expect(frames.at(-1)?.dropped).toBe(8);

    await send(3);
    const ready = decoders[1]!.output(); // decoded, waiting for presentation
    await send(3, 1, 3, 2); // one in flight, new config, skipped delta, new IDR
    expect(ready.closed).toBe(1);
    expect(presentations.size).toBe(0);
    decoders[1]!.output(); // stale callback cannot count the in-flight frame twice
    now = 40;
    decoders[2]!.output();
    expect(frames.at(-1)?.dropped).toBe(11);

    await send(3);
    const unmounted = decoders[2]!.output();
    await send(3);
    if (typeof cleanup === "function") cleanup();
    cleanup = undefined;
    expect(unmounted.closed).toBe(1);
    expect(presentations.size).toBe(0);
    expect(decoders[2]!.output().closed).toBe(1);
    expect(frames).toHaveLength(3);
    expect(frames.at(-1)?.dropped).toBe(11);
  } finally {
    if (typeof cleanup === "function") cleanup();
    stream?.close();
    effectSpy.mockRestore();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
