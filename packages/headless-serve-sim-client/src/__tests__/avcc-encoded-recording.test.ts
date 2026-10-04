import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { AvccDemuxer } from "../avcc-codec";
import { useAvccStream } from "../simulator/use-avcc-stream";

function timing(timestamp: bigint, sequence: bigint): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, timestamp);
  view.setBigUint64(8, 16667n);
  view.setBigUint64(16, sequence);
  return bytes;
}

test("encoded recording receives source timing before disposable decoder drops", async () => {
  const effects: React.EffectCallback[] = [];
  const effectSpy = spyOn(React, "useEffect").mockImplementation((effect) => effects.push(effect));
  let handleChunk!: Parameters<AvccDemuxer["visit"]>[1];
  const visitor = spyOn(AvccDemuxer.prototype, "visit").mockImplementation((_bytes, handle) => {
    handleChunk = handle;
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  const events: unknown[] = [];
  let received!: () => void;
  const requested = new Promise<void>((resolve) => (received = resolve));
  try {
    replace(
      "VideoDecoder",
      class {
        state = "unconfigured";
        decodeQueueSize = 12;
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
    replace("requestAnimationFrame", () => 1);
    replace("cancelAnimationFrame", () => {});
    replace(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({ start: (controller) => controller.enqueue(new Uint8Array([1])) }),
        ),
    );
    useAvccStream({
      url: "http://stream.test",
      enabled: true,
      canvasRef: { current: null },
      onProgress: received,
      onEncoded: (event) => events.push(event),
    });
    cleanup = effects[0]!();
    await requested;
    handleChunk("description", new Uint8Array([1, 0x64, 0, 0x34]));
    handleChunk("timing", timing(123456789012n, 7n));
    handleChunk("keyframe", new Uint8Array([9]));
    handleChunk("timing", timing(123456822349n, 8n));
    handleChunk("disposable-delta", new Uint8Array([8]));
    expect(events).toEqual([
      { type: "description", data: new Uint8Array([1, 0x64, 0, 0x34]) },
      {
        type: "picture",
        keyframe: true,
        data: new Uint8Array([9]),
        timestampMicroseconds: 123456789012,
        durationMicroseconds: 16667,
        sequence: 7,
        composition: undefined,
      },
      {
        type: "picture",
        keyframe: false,
        data: new Uint8Array([8]),
        timestampMicroseconds: 123456822349,
        durationMicroseconds: 16667,
        sequence: 8,
        composition: undefined,
      },
    ]);
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

test("encoded recording is notified when its source connection ends", async () => {
  const effects: React.EffectCallback[] = [];
  const effectSpy = spyOn(React, "useEffect").mockImplementation((effect) => effects.push(effect));
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const events: { type: string; error?: Error }[] = [];
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  try {
    replace("VideoDecoder", class {});
    replace(
      "fetch",
      async () => new Response(new ReadableStream({ start: (controller) => controller.close() })),
    );
    useAvccStream({
      url: "http://stream.test",
      enabled: true,
      canvasRef: { current: null },
      onEncoded: (event) => events.push(event),
    });
    cleanup = effects[0]!();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(events.at(-1)?.type).toBe("error");
    expect(events.at(-1)?.error?.message).toBe("encoded stream disconnected");
  } finally {
    if (typeof cleanup === "function") cleanup();
    effectSpy.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
