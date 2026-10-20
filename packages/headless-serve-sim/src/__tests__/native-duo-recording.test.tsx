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
  let repaint!: () => void;
  let paths = 0;
  const clips: unknown[][] = [];
  const handlers = new Map<string, (event: any) => void>();
  const single: unknown[] = [],
    multi: unknown[] = [],
    hardware: string[] = [];
  const outputRef: React.MutableRefObject<SimulatorRecordingSource | null> = { current: null };
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  try {
    replace("requestAnimationFrame", (callback: FrameRequestCallback) => {
      tick = callback;
      return 1;
    });
    replace("cancelAnimationFrame", () => {});
    replace(
      "Path2D",
      class {
        constructor() {
          paths++;
        }
      },
    );
    let encodedSubscriptions = 0,
      keyframeRequests = 0;
    let rotation = 0;
    const source: SimulatorRecordingSource = {
      subscribe(listener) {
        repaint = listener;
        return () => {};
      },
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
          rotation,
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
    const view = NativeDuoDevice({
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
      onButton(button) {
        hardware.push(button);
      },
      includeFrame: true,
      onBoundsChange() {},
    });
    expect(view.props.children[0].props.style.cursor).toContain("%3Ccircle");
    const buttons = view.props.children[1].props.children;
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.props.children.props.className).toBe("duo-hardware-icon");
      expect(button.props.children.props.children.type).toBe("svg");
      button.props.onClick();
    }
    expect(hardware).toEqual(["lock", "volume_up", "volume_down"]);
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
    replace("window", { addEventListener() {}, removeEventListener() {} });
    const originalSnapshot = source.snapshot;
    let ready = false;
    source.snapshot = () => (ready ? originalSnapshot() : null);
    cleanup = effects[0]!();
    tick(0);
    ready = true;
    tick(16);
    for (let i = 0; i < 60; i++) repaint();
    expect(paths).toBe(1);
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
    expect(snapshot.surfaceWidth).toBeCloseTo(450 / 0.63);
    expect(snapshot.surfaceHeight).toBeCloseTo((450 * 900) / (1280 * 0.63));
    expect(snapshot.width / snapshot.height).toBeCloseTo(
      snapshot.surfaceWidth / snapshot.surfaceHeight,
    );
    expect(clips[0]?.[1]).toBe("evenodd");
    // The fit follows the turn each composite carries, so the scale moves with the picture.
    rotation = 90;
    repaint();
    expect(outputRef.current!.snapshot()!.surfaceWidth).toBeCloseTo(450 / 0.82);
    rotation = 0;
    repaint();
    expect(outputRef.current!.snapshot()!.surfaceWidth).toBeCloseTo(450 / 0.63);
    const event = {
      clientX: 160,
      clientY: 180,
      pointerId: 1,
      button: 0,
      altKey: true,
      shiftKey: false,
      preventDefault() {},
    };
    const dots = [{ style: {} as Record<string, string> }, { style: {} as Record<string, string> }];
    refs.at(-1)!.current = { querySelectorAll: () => dots };
    handlers.get("pointerdown")!(event);
    expect(dots.map((dot) => dot.style.display)).toEqual(["block", "block"]);
    expect(dots[0]!.style.left).not.toBe(dots[1]!.style.left);
    handlers.get("pointermove")!({ ...event, clientX: 192 });
    handlers.get("pointerup")!({ ...event, clientX: 192 });
    expect(single).toEqual([]);
    expect(multi).toEqual([
      { type: "begin", x1: 0.25, y1: 0.4, x2: 0.75, y2: 0.6, displayId: 3 },
      { type: "move", x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.6, displayId: 3 },
      { type: "end", x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.6, displayId: 3 },
    ]);
    const scroll: unknown[] = [];
    refs[2]!.current = {
      ...(refs[2]!.current as object),
      onScroll: (data: unknown) => scroll.push(data),
    };
    handlers.get("wheel")!({ ...event, deltaMode: 2, deltaX: 1, deltaY: 0 });
    const scrolled = scroll[0] as {
      x: number;
      y: number;
      dx: number;
      dy: number;
      displayId: number;
    };
    expect(scrolled.x).toBe(0.25);
    expect(scrolled.y).toBe(0.4);
    expect(scrolled.dx).toBeCloseTo(2007);
    expect(Math.abs(scrolled.dy)).toBe(0);
    expect(scrolled.displayId).toBe(3);
    multi.length = 0;
    const first = { ...event, pointerType: "touch", altKey: false, pointerId: 10 };
    const second = { ...first, pointerId: 11, clientX: 480, clientY: 270 };
    handlers.get("pointerdown")!(first);
    handlers.get("pointerdown")!(second);
    handlers.get("pointermove")!({ ...second, clientX: 448 });
    handlers.get("pointerup")!({ ...second, clientX: 448 });
    handlers.get("pointerup")!(first);
    expect(multi).toEqual([
      { type: "begin", x1: 0.25, y1: 0.4, x2: 0.75, y2: 0.6, displayId: 3 },
      { type: "move", x1: 0.25, y1: 0.4, x2: 0.7, y2: 0.6, displayId: 3 },
      { type: "end", x1: 0.25, y1: 0.4, x2: 0.7, y2: 0.6, displayId: 3 },
    ]);
    const polygons: {
      attributes: Record<string, string>;
      style: object;
      setAttribute(key: string, value: string): void;
      addEventListener(): void;
    }[] = [];
    const overlay = {
      children: polygons,
      replaceChildren() {
        polygons.length = 0;
      },
      append(polygon: (typeof polygons)[number]) {
        polygons.push(polygon);
      },
    };
    refs[1]!.current = overlay;
    (refs[0]!.current as { parentElement: unknown }).parentElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
    replace("document", {
      createElementNS: () => ({
        attributes: {} as Record<string, string>,
        style: {},
        setAttribute(key: string, value: string) {
          this.attributes[key] = value;
        },
        addEventListener() {},
      }),
    });
    refs[4]!.current = {
      snapshot: {
        elements: [
          {
            id: "button",
            path: "0",
            label: "",
            role: "",
            type: "Button",
            enabled: true,
            frame: { x: 100, y: 100, width: 100, height: 100 },
          },
        ],
      },
      selection: { selectedKey: null, highlightedKey: null },
    };
    refs[2]!.current = { ...(refs[2]!.current as object), axEnabled: true };
    repaint();
    expect(polygons[0]?.attributes["aria-label"]).toContain("element 1");
    ready = false;
    repaint();
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
