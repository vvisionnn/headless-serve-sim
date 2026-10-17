import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { SimulatorView, type SimulatorRecordingSource } from "../simulator/SimulatorView";
import { AvccDemuxer } from "../avcc-codec";

test("recording source replays its encoded description and requests a fresh IDR", async () => {
  const effects: { effect: React.EffectCallback; deps?: React.DependencyList }[] = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const spies = [
    spyOn(React, "useRef").mockImplementation((current) => ({ current })),
    spyOn(React, "useState").mockImplementation(<S>(value?: S | (() => S)) => [
      typeof value === "function" ? (value as () => S)() : (value as S),
      () => {},
    ]),
    spyOn(React, "useCallback").mockImplementation((callback) => callback),
    spyOn(React, "useEffect").mockImplementation((effect, deps) => effects.push({ effect, deps })),
    spyOn(React, "useLayoutEffect").mockImplementation((effect, deps) =>
      effects.push({ effect, deps }),
    ),
  ];
  let handleChunk!: Parameters<AvccDemuxer["visit"]>[1];
  const visitor = spyOn(AvccDemuxer.prototype, "visit").mockImplementation(
    (_bytes, handle) => (handleChunk = handle),
  );
  let decoderCleanup: ReturnType<React.EffectCallback> = undefined;
  let sourceCleanup: ReturnType<React.EffectCallback> = undefined;
  try {
    replace(
      "VideoDecoder",
      class {
        configure() {}
        close() {}
      },
    );
    replace("EncodedVideoChunk", class {});
    replace(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({ start: (controller) => controller.enqueue(new Uint8Array([1])) }),
        ),
    );
    const recordingSourceRef: React.MutableRefObject<SimulatorRecordingSource | null> = {
      current: null,
    };
    let requested = 0;
    SimulatorView({
      url: "http://stream.test",
      codec: "avcc",
      onStreamTouch() {},
      onStreamRequestKeyframe: () => requested++,
      recordingSourceRef,
    });
    decoderCleanup = effects
      .find(
        ({ deps }) =>
          deps?.[0] === "http://stream.test" && deps[1] === true && typeof deps[2] === "object",
      )!
      .effect();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const description = new Uint8Array([1, 0x64, 0, 0x34]);
    handleChunk("description", description);
    sourceCleanup = effects.find(({ deps }) => deps?.includes(recordingSourceRef))!.effect();
    const events: unknown[] = [];
    const unsubscribe = recordingSourceRef.current?.subscribeEncoded?.((event) =>
      events.push(event),
    );
    expect(events).toEqual([{ type: "description", data: description }]);
    recordingSourceRef.current?.requestKeyframe?.();
    expect(requested).toBe(1);
    unsubscribe?.();
  } finally {
    if (typeof decoderCleanup === "function") decoderCleanup();
    if (typeof sourceCleanup === "function") sourceCleanup();
    visitor.mockRestore();
    for (const spy of spies) spy.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
