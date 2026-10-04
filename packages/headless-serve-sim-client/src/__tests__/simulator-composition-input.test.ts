import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { SimulatorView, type SimulatorViewProps } from "../simulator/SimulatorView";
import type { SimulatorComposition } from "../types";

const composition: SimulatorComposition = {
  angle: 0,
  rotation: 0,
  scale: 1,
  displayId: 1,
  rawWidth: 1398,
  rawHeight: 2034,
  rawRotation: 0,
  mask: "M0 0Z",
  bounds: [0.2, 0.2, 0.4, 0.5],
  pieces: [
    {
      displayId: 1,
      region: [0, 0, 1, 1],
      quad: [
        [0.2, 0.2],
        [0.6, 0.2],
        [0.6, 0.7],
        [0.2, 0.7],
      ],
    },
  ],
};

function find(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<any>;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

async function withView(
  run: (fixture: {
    render(props?: Partial<SimulatorViewProps>): React.ReactElement;
    commit(dependency: unknown): void;
    start(): void;
    load(metadata?: SimulatorComposition): void;
    input(): React.ReactElement<any>;
    wheel(event: Partial<WheelEvent>): void;
  }) => void | Promise<void>,
) {
  const refs: { current: unknown }[] = [];
  const states: { value: unknown }[] = [];
  const effects: { effect: React.EffectCallback; deps?: React.DependencyList }[] = [];
  const cleanups: ReturnType<React.EffectCallback>[] = [];
  let refIndex = 0,
    stateIndex = 0;
  const spies = [
    spyOn(React, "useRef").mockImplementation(
      (value: unknown) => (refs[refIndex++] ??= { current: value }),
    ),
    spyOn(React, "useState").mockImplementation(<S>(value?: S | (() => S)) => {
      const state = (states[stateIndex++] ??= {
        value: typeof value === "function" ? (value as () => S)() : value,
      });
      return [
        state.value as S,
        (next: React.SetStateAction<S>) => {
          state.value =
            typeof next === "function" ? (next as (previous: S) => S)(state.value as S) : next;
        },
      ];
    }),
    spyOn(React, "useCallback").mockImplementation((callback) => callback),
    spyOn(React, "useEffect").mockImplementation((effect, deps) => {
      effects.push({ effect, deps });
    }),
  ];
  const raf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: () => 1,
  });
  let tree!: React.ReactElement;
  let frame!: (url: string, bytes?: number, metadata?: SimulatorComposition) => void;
  const subscribeFrame = (callback: typeof frame) => {
    frame = callback;
    return () => {};
  };
  let wheelListener!: (event: WheelEvent) => void;
  const image = { naturalWidth: 3420, naturalHeight: 3420, src: "", currentSrc: "" };
  let frameId = 0;
  const input = () => find(tree, (element) => element.props["data-testid"] === "simulator-input")!;
  const commit = (dependency: unknown) => {
    const effect = effects.find(
      ({ deps }) =>
        deps?.includes(dependency) ||
        (typeof dependency === "boolean" && deps?.length === 1 && deps[0] === dependency),
    );
    if (effect) cleanups.push(effect.effect());
  };
  try {
    await run({
      render(props = {}) {
        refIndex = stateIndex = 0;
        effects.length = 0;
        tree = SimulatorView({
          url: "http://stream.test",
          codec: "mjpeg",
          onStreamTouch: () => {},
          subscribeFrame,
          ...props,
        });
        const imageElement = find(
          tree,
          (element) => element.type === "img" && element.props.style?.display !== "none",
        )!;
        imageElement.props.ref.current = image;
        const surface = find(
          tree,
          (element) =>
            element.type === "div" &&
            element.props.style?.position === "relative" &&
            element.props.style?.overflow === "hidden",
        )!;
        surface.props.ref.current = {
          getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 1000 }),
        };
        input().props.ref.current = {
          addEventListener(type: string, callback: (event: WheelEvent) => void) {
            if (type === "wheel") wheelListener = callback;
          },
          removeEventListener() {},
        };
        return tree;
      },
      commit,
      start() {
        commit(subscribeFrame);
      },
      load(metadata = composition) {
        if (!frame) commit(subscribeFrame);
        frame(`blob:frame-${++frameId}`, 100, metadata);
        image.currentSrc = image.src;
        const element = find(
          tree,
          (element) => element.type === "img" && element.props.style?.display !== "none",
        )!;
        element.props.onLoad({ currentTarget: image });
      },
      input,
      wheel(event) {
        if (!wheelListener)
          cleanups.push(
            effects
              .find(
                ({ deps }) =>
                  deps?.length === 3 && deps[0] === undefined && typeof deps[1] === "function",
              )!
              .effect(),
          );
        wheelListener({
          clientX: 300,
          clientY: 400,
          deltaX: 10,
          deltaY: 20,
          deltaMode: 0,
          preventDefault() {},
          stopPropagation() {},
          ...event,
        } as WheelEvent);
      },
    });
  } finally {
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === "function") cleanup();
    for (const spy of spies) spy.mockRestore();
    if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  }
}

const mouse = (x: number, y: number, extra = {}) => ({
  clientX: x * 1000,
  clientY: y * 1000,
  preventDefault() {},
  buttons: 1,
  ...extra,
});
const touch = (x: number, y: number) => ({ clientX: x * 1000, clientY: y * 1000 });

test("hidden viewers report actual stream errors and clear them with a healthy loaded frame", async () => {
  let watchdog!: () => void;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delay: number,
  ) => {
    if (delay === 6000) watchdog = callback;
    return 1;
  }) as typeof setTimeout);
  try {
    await withView(({ render, commit, start, load }) => {
      const errors: (string | null)[] = [];
      const report = (error: string | null) => errors.push(error);
      const props = { onStreamError: report } as Partial<SimulatorViewProps>;
      render(props);
      start();
      commit(report);
      watchdog();
      render(props);
      commit(report);
      load();
      render(props);
      commit(report);
      expect(errors).toEqual([
        null,
        "Stream is not producing frames. The simulator may have stopped — try reconnecting.",
        null,
      ]);
    });
  } finally {
    timers.mockRestore();
  }
});

test("direct MJPEG binds composition to its loaded JPEG using one parsed video stream", async () => {
  const sockets: { onopen?: () => void; onerror?: () => void; send(bytes: Uint8Array): void }[] =
    [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: class {
      static OPEN = 1;
      readyState = 1;
      onopen?: () => void;
      constructor() {
        sockets.push(this);
      }
      close() {}
      send(_bytes: Uint8Array) {}
    },
  });
  const urls: string[] = [];
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const metadata = new TextEncoder().encode(JSON.stringify(composition));
  const length = metadata.length + 11;
  const jpeg = new Uint8Array(metadata.length + 17);
  jpeg.set([0xff, 0xd8, 0xff, 0xef, length >> 8, length & 0xff, 83, 83, 67, 77, 49, 0, 0, 0, 1]);
  jpeg.set(metadata, 15);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  const header = new TextEncoder().encode(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
  );
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    url: URL | RequestInfo,
  ) => {
    urls.push(String(url));
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
          controller.enqueue(header.subarray(0, 4));
          controller.enqueue(header.subarray(4));
          controller.enqueue(jpeg.subarray(0, 25));
          controller.enqueue(jpeg.subarray(25));
        },
      }),
    );
  }) as typeof fetch);
  let blobId = 0;
  const blobs = spyOn(URL, "createObjectURL").mockImplementation(() => `blob:direct-${++blobId}`);
  try {
    await withView(async ({ render, commit, input }) => {
      const statuses: boolean[] = [];
      const onStreamingChange = (streaming: boolean) => statuses.push(streaming);
      const props = { onStreamTouch: undefined, onStreamingChange };
      const tree = render(props);
      commit("http://stream.test/stream.mjpeg");
      const webSocket = sockets[0]!;
      webSocket.onerror?.();
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const image = find(
        tree,
        (element) => element.type === "img" && element.props.style?.display !== "none",
      )!;
      expect(urls).toEqual(["http://stream.test/stream.mjpeg?raw=1"]);
      expect(image.props.src).toBeUndefined();
      expect(image.props.ref.current.src).toBe("blob:direct-1");
      image.props.ref.current.currentSrc = image.props.ref.current.src;
      image.props.onLoad({ currentTarget: image.props.ref.current });
      render(props);
      const recovered = render(props);
      commit(false);
      commit(true);
      expect(statuses.at(-1)).toBe(true);
      expect(
        find(
          recovered,
          (element) =>
            element.type === "span" && element.props.children === "WebSocket connection failed",
        ),
      ).toBeNull();
      const sent: unknown[] = [];
      webSocket.send = (bytes: Uint8Array) =>
        sent.push(JSON.parse(new TextDecoder().decode(bytes.subarray(1))));
      input().props.onMouseDown(mouse(0.3, 0.4));
      expect(sent[0]).toMatchObject({ type: "begin", displayId: 1 });
      expect((sent[0] as any).x).toBeCloseTo(0.25);
      stream.close();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      render(props);
      commit(false);
      commit(true);
      expect(statuses.at(-1)).toBe(false);
    });
  } finally {
    fetchSpy.mockRestore();
    blobs.mockRestore();
    if (descriptor) Object.defineProperty(globalThis, "WebSocket", descriptor);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  }
});

test("loaded composition JPEG keeps native canvas geometry after a landscape config push", async () => {
  await withView(({ render, commit, load }) => {
    const streamConfig = {
      width: 3420,
      height: 3420,
      orientation: "landscape_left" as const,
      deviceComposition: true,
      includeFrame: true,
    };
    const props = { streamConfig };
    render(props);
    commit(streamConfig);
    load();
    const tree = render(props);
    const image = find(
      tree,
      (element) => element.type === "img" && element.props.style?.display !== "none",
    )!;
    expect(image.props.style.transform).toBe("translate(-50%, -50%)");
  });
});

test("public viewer inverse-projects input to the frame's display", async () => {
  await withView(({ render, load, input }) => {
    const sent: Parameters<NonNullable<SimulatorViewProps["onStreamTouch"]>>[0][] = [];
    render({ onStreamTouch: (event) => sent.push(event) });
    load();
    input().props.onMouseDown(mouse(0.3, 0.4));
    input().props.onMouseUp(mouse(0.3, 0.4));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: "begin", displayId: 1 });
    expect(sent[0]!.x).toBeCloseTo(0.25);
    expect(sent[0]!.y).toBeCloseTo(0.4);
    expect(sent[1]).toMatchObject({ type: "end", displayId: 1 });
  });
});

test("composition wheel deltas use inverse projection and raw panel pixel dimensions", async () => {
  await withView(({ render, load, wheel }) => {
    const sent: Parameters<NonNullable<SimulatorViewProps["onStreamScroll"]>>[0][] = [];
    render({ onStreamScroll: (event) => sent.push(event) });
    load();
    wheel({});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ displayId: 1 });
    expect(sent[0]!.x).toBeCloseTo(0.25);
    expect(sent[0]!.y).toBeCloseTo(0.4);
    expect(sent[0]!.dx).toBeCloseTo(34.95);
    expect(sent[0]!.dy).toBeCloseTo(81.36);
  });
});

test("Alt pinch mirrors fingers in raw panel space rather than the full composition", async () => {
  await withView(({ render, load, input }) => {
    const sent: Parameters<NonNullable<SimulatorViewProps["onStreamMultiTouch"]>>[0][] = [];
    render({ onStreamMultiTouch: (event) => sent.push(event) });
    load();
    input().props.onMouseDown(mouse(0.3, 0.4, { altKey: true }));
    input().props.onMouseMove(mouse(0.34, 0.45, { altKey: true }));
    input().props.onMouseUp(mouse(0.34, 0.45, { altKey: true }));
    expect(sent.map((event) => [event.type, event.displayId])).toEqual([
      ["begin", 1],
      ["move", 1],
      ["end", 1],
    ]);
    expect(sent[0]!.x1).toBeCloseTo(0.25);
    expect(sent[0]!.y1).toBeCloseTo(0.4);
    expect(sent[0]!.x2).toBeCloseTo(0.75);
    expect(sent[0]!.y2).toBeCloseTo(0.6);
    expect(sent[2]).toEqual({ ...sent[1]!, type: "end" });
  });
});

test("composition touch multitouch retains two inverse-projected points and displayId", async () => {
  await withView(({ render, load, input }) => {
    const sent: Parameters<NonNullable<SimulatorViewProps["onStreamMultiTouch"]>>[0][] = [];
    render({ onStreamMultiTouch: (event) => sent.push(event) });
    load();
    input().props.onTouchStart({
      preventDefault() {},
      touches: [touch(0.3, 0.4), touch(0.5, 0.5)],
    });
    input().props.onTouchMove({
      preventDefault() {},
      touches: [touch(0.34, 0.45), touch(0.54, 0.55)],
    });
    input().props.onTouchEnd({ preventDefault() {}, touches: [], changedTouches: [] });
    expect(sent.map((event) => [event.type, (event as any).displayId])).toEqual([
      ["begin", 1],
      ["move", 1],
      ["end", 1],
    ]);
    expect(sent[0]!.x1).toBeCloseTo(0.25);
    expect(sent[0]!.y1).toBeCloseTo(0.4);
    expect(sent[0]!.x2).toBeCloseTo(0.75);
    expect(sent[0]!.y2).toBeCloseTo(0.6);
    expect(sent[2]).toEqual({ ...sent[1]!, type: "end" });
  });
});

test("a second touch closes an active composition home-edge drag before multitouch", async () => {
  await withView(({ render, load, input }) => {
    const single: Parameters<NonNullable<SimulatorViewProps["onStreamTouch"]>>[0][] = [];
    const multi: Parameters<NonNullable<SimulatorViewProps["onStreamMultiTouch"]>>[0][] = [];
    render({
      onStreamTouch: (event) => single.push(event),
      onStreamMultiTouch: (event) => multi.push(event),
    });
    load({
      ...composition,
      pieces: [
        {
          ...composition.pieces[0]!,
          quad: [
            [0.2, 0.2],
            [0.6, 0.2],
            [0.6, 1],
            [0.2, 1],
          ],
        },
      ],
    });
    input().props.onTouchStart({ preventDefault() {}, touches: [touch(0.4, 0.96)] });
    input().props.onTouchStart({
      preventDefault() {},
      touches: [touch(0.4, 0.96), touch(0.5, 0.5)],
    });
    expect(single.map((event) => [event.type, event.displayId, event.edge])).toEqual([
      ["begin", 1, 3],
      ["end", 1, 3],
    ]);
    expect(multi[0]).toMatchObject({ type: "begin", displayId: 1 });
  });
});

test("composition home edges and gesture endings retain their raw display target", async () => {
  await withView(({ render, load, input }) => {
    const sent: Parameters<NonNullable<SimulatorViewProps["onStreamTouch"]>>[0][] = [];
    render({ onStreamTouch: (event) => sent.push(event) });
    load();
    input().props.onMouseDown(mouse(0.4, 0.68));
    input().props.onMouseMove(mouse(0.4, 0.6));
    load({ ...composition, displayId: 3 });
    input().props.onMouseUp(mouse(0.9, 0.9));
    expect(sent.map((event) => [event.type, (event as any).displayId, event.edge])).toEqual([
      ["begin", 1, 3],
      ["move", 1, 3],
      ["end", 1, 3],
    ]);
    expect(sent[2]!.x).toBeCloseTo(0.5);
    expect(sent[2]!.y).toBeCloseTo(0.8);
  });
});
