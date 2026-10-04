import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import type { SimulatorRecordingSource } from "headless-serve-sim-client/simulator";
import { NativeDuoDevice } from "../client/components/native-duo-device";

test("native composition paints mask holes and records its fitted canvas aspect", () => {
  const effects: React.EffectCallback[] = [],
    refs: { current: unknown }[] = [];
  const spies = [
    spyOn(React, "useEffect").mockImplementation((effect) => {
      effects.push(effect);
    }),
    spyOn(React, "useLayoutEffect").mockImplementation(() => {}),
    spyOn(React, "useRef").mockImplementation((value) => {
      const ref = { current: value };
      refs.push(ref);
      return ref;
    }),
    spyOn(React, "useContext").mockImplementation(
      <T,>() => ({ snapshot: null, selection: null }) as T,
    ),
  ];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let tick!: FrameRequestCallback;
  const clips: unknown[][] = [];
  const handlers = new Map<string, (event: any) => void>();
  const single: unknown[] = [],
    multi: unknown[] = [];
  const outputRef: React.MutableRefObject<SimulatorRecordingSource | null> = { current: null };
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  try {
    replace("requestAnimationFrame", (callback: FrameRequestCallback) => {
      tick = callback;
      return 1;
    });
    replace("cancelAnimationFrame", () => {});
    replace("Path2D", class {});
    let encodedSubscriptions = 0,
      keyframeRequests = 0;
    const source: SimulatorRecordingSource = {
      subscribeEncoded(listener) {
        encodedSubscriptions++;
        listener({ type: "description", data: new Uint8Array([1, 100, 0, 52]) });
        return () => encodedSubscriptions--;
      },
      requestKeyframe() {
        keyframeRequests++;
      },
      snapshot: () => ({
        source: {} as HTMLCanvasElement,
        width: 1280,
        height: 900,
        surfaceWidth: 1280,
        surfaceHeight: 900,
        touches: [],
        composition: {
          angle: 180,
          rotation: 0,
          scale: 1,
          displayId: 3,
          rawWidth: 2007,
          rawHeight: 2853,
          rawRotation: 90,
          bounds: [0, 0, 1, 1],
          pieces: [
            {
              displayId: 3,
              quad: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
              region: [0, 0, 1, 1],
            },
          ],
          mask: "M0 0L1 0L1 1L0 1ZM.25 .25L.75 .25L.75 .75L.25 .75Z",
        },
      }),
    };
    NativeDuoDevice({
      sourceRef: { current: source },
      recordingSourceRef: outputRef,
      width: 1000,
      height: 450,
      axEnabled: false,
      onTouch(event) {
        single.push(event);
      },
      onMultiTouch(event) {
        multi.push(event);
      },
      onScroll() {},
      includeFrame: true,
      onBoundsChange() {},
    });
    refs[0]!.current = {
      width: 0,
      height: 0,
      style: {},
      addEventListener(type: string, handler: (event: any) => void) {
        handlers.set(type, handler);
      },
      removeEventListener() {},
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 450 }),
      setPointerCapture() {},
      hasPointerCapture: () => false,
      getContext: () => ({
        setTransform() {},
        clearRect() {},
        save() {},
        scale() {},
        clip(...args: unknown[]) {
          clips.push(args);
        },
        drawImage() {},
        restore() {},
      }),
    };
    const originalSnapshot = source.snapshot;
    let ready = false;
    source.snapshot = () => (ready ? originalSnapshot() : null);
    cleanup = effects[0]!();
    tick(0);
    ready = true;
    tick(16);
    const snapshot = outputRef.current!.snapshot()!;
    expect(snapshot.composition).toEqual(source.snapshot()!.composition);
    const encoded: unknown[] = [];
    const unsubscribeEncoded = outputRef.current?.subscribeEncoded?.((event) =>
      encoded.push(event),
    );
    expect(encodedSubscriptions).toBe(1);
    expect(encoded).toEqual([{ type: "description", data: new Uint8Array([1, 100, 0, 52]) }]);
    outputRef.current?.requestKeyframe?.();
    expect(keyframeRequests).toBe(1);
    unsubscribeEncoded?.();
    expect(encodedSubscriptions).toBe(0);
    source.subscribeEncoded = undefined;
    source.requestKeyframe = undefined;
    expect(outputRef.current?.subscribeEncoded).toBeUndefined();
    expect(outputRef.current?.requestKeyframe).toBeUndefined();
    expect(snapshot.surfaceWidth).toBeCloseTo(450 / 0.85);
    expect(snapshot.surfaceHeight).toBeCloseTo((450 * 900) / (1280 * 0.85));
    expect(snapshot.width / snapshot.height).toBeCloseTo(
      snapshot.surfaceWidth / snapshot.surfaceHeight,
    );
    expect(clips[0]?.[1]).toBe("evenodd");
    const event = {
      clientX: 160,
      clientY: 180,
      pointerId: 1,
      button: 0,
      altKey: true,
      shiftKey: false,
      preventDefault() {},
    };
    handlers.get("pointerdown")!(event);
    handlers.get("pointermove")!({ ...event, clientX: 192 });
    handlers.get("pointerup")!({ ...event, clientX: 192 });
    expect(single).toEqual([]);
    expect(multi).toEqual([
      { type: "begin", x1: 0.25, y1: 0.4, x2: 0.75, y2: 0.6, displayId: 3 },
      { type: "move", x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.6, displayId: 3 },
      { type: "end", x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.6, displayId: 3 },
    ]);
    refs[2]!.current = { ...(refs[2]!.current as object), includeFrame: false };
    outputRef.current!.snapshot();
    tick(0);
    expect(outputRef.current!.snapshot()).toBeNull();
  } finally {
    if (typeof cleanup === "function") cleanup();
    for (const spy of spies) spy.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
