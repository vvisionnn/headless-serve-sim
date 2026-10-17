import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import Gateway, { type GatewayShell } from "../gateway";
import { useGateway } from "../react";
import { SimulatorView } from "../simulator/SimulatorView";
import { GatewayTransport } from "../transport";
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

function jpeg(metadata?: SimulatorComposition): Uint8Array {
  if (!metadata) return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const length = json.length + 11;
  const bytes = new Uint8Array(json.length + 17);
  bytes.set([0xff, 0xd8, 0xff, 0xef, length >> 8, length & 0xff, 83, 83, 67, 77, 49, 0, 0, 0, 1]);
  bytes.set(json, 15);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

async function withTransport(
  run: (transport: GatewayTransport, send: (bytes: Uint8Array) => void) => Promise<void>,
  format: "binary" | "json",
) {
  const clients = new Set<{ send(data: string | Uint8Array): unknown }>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(socket) {
        clients.add(socket);
      },
      close(socket) {
        clients.delete(socket);
      },
      message() {},
    },
  });
  const transport = new GatewayTransport({
    url: `ws://127.0.0.1:${server.port}`,
    heartbeat: false,
  });
  try {
    await transport.waitForOpen();
    await run(transport, (bytes) => {
      let data: string | Uint8Array;
      if (format === "json")
        data = JSON.stringify({
          type: "stream:frame",
          data: Buffer.from(bytes).toString("base64"),
        });
      else {
        data = new Uint8Array(bytes.length + 1);
        data[0] = 0x01;
        data.set(bytes, 1);
      }
      for (const socket of clients) socket.send(data);
    });
  } finally {
    transport.close();
    server.stop(true);
  }
}

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

test("gateway hook forwards and replays frame composition to the viewer", async () => {
  await withTransport(async (transport, send) => {
    const effects: { effect: React.EffectCallback; dependencies?: React.DependencyList }[] = [];
    const cleanups: ReturnType<React.EffectCallback>[] = [];
    const spies = [
      spyOn(React, "useRef").mockImplementation((current) => ({ current })),
      spyOn(React, "useState").mockImplementation(<S>(value?: S | (() => S)) => [
        (typeof value === "function" ? (value as () => S)() : value) as S,
        () => {},
      ]),
      spyOn(React, "useCallback").mockImplementation((callback) => callback),
      spyOn(React, "useMemo").mockImplementation((factory) => factory()),
      spyOn(React, "useEffect").mockImplementation((effect, dependencies) => {
        effects.push({ effect, dependencies });
      }),
      spyOn(React, "useLayoutEffect").mockImplementation((effect, dependencies) => {
        effects.push({ effect, dependencies });
      }),
      spyOn(Gateway, "connect").mockResolvedValue({ transport, close() {} } as GatewayShell),
    ];
    const url = "ws://gateway.test";
    try {
      const { stream } = useGateway({ url });
      cleanups.push(effects.find(({ dependencies }) => dependencies?.includes(url))!.effect());
      await Promise.resolve();
      const nextFrame = () =>
        new Promise<{ url: string; metadata?: SimulatorComposition }>((resolve) => {
          const unsubscribe = stream.subscribeFrame((url, _bytes, metadata) => {
            unsubscribe();
            resolve({ url, metadata });
          });
        });
      const firstPending = nextFrame();
      send(jpeg(composition));
      const first = await firstPending;
      try {
        expect(first.metadata).toEqual(composition);
        const replay: unknown[] = [];
        const unsubscribe = stream.subscribeFrame((_url, _bytes, metadata) =>
          replay.push(metadata),
        );
        expect(replay).toEqual([composition]);
        unsubscribe();

        const touches: { x: number; y: number; displayId?: number }[] = [];
        const tree = SimulatorView({
          url: "http://stream.test",
          codec: "mjpeg",
          subscribeFrame: stream.subscribeFrame,
          onStreamTouch: (touch) => touches.push(touch),
        });
        const image = find(
          tree,
          (node) => node.type === "img" && node.props.style?.display !== "none",
        )!;
        const loaded = { naturalWidth: 3420, naturalHeight: 3420, src: "", currentSrc: "" };
        image.props.ref.current = loaded;
        const surface = find(
          tree,
          (node) =>
            node.type === "div" &&
            node.props.style?.position === "relative" &&
            node.props.style?.overflow === "hidden",
        )!;
        surface.props.ref.current = {
          getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 1000 }),
        };
        cleanups.push(
          effects
            .find(({ dependencies }) => dependencies?.includes(stream.subscribeFrame))!
            .effect(),
        );
        loaded.currentSrc = loaded.src;
        image.props.onLoad({ currentTarget: loaded });
        const input = find(tree, (node) => node.props["data-testid"] === "simulator-input")!;
        input.props.onMouseDown({ clientX: 240, clientY: 300, altKey: false, preventDefault() {} });
        input.props.onMouseUp({ clientX: 240, clientY: 300 });
        expect(touches).toHaveLength(2);
        for (const touch of touches) {
          expect(touch.x).toBeCloseTo(0.1);
          expect(touch.y).toBeCloseTo(0.2);
          expect(touch.displayId).toBe(1);
        }
        const received: (SimulatorComposition | undefined)[] = [];
        const stop = stream.subscribeFrame((_url, _bytes, metadata) => received.push(metadata));
        const waitForFrame = () =>
          new Promise<string>((resolve) => {
            const unsubscribe = transport.onStreamFrame((url) => {
              unsubscribe();
              resolve(url);
            });
          });
        const secondComposition = { ...composition, displayId: 3 };
        const secondPending = waitForFrame();
        send(jpeg(secondComposition));
        const secondUrl = await secondPending;
        const ordinaryPending = waitForFrame();
        send(jpeg());
        const ordinaryUrl = await ordinaryPending;
        try {
          expect(received).toEqual([composition, secondComposition, undefined]);
          const current: unknown[] = [];
          const stopCurrent = stream.subscribeFrame((_url, _bytes, metadata) =>
            current.push(metadata),
          );
          expect(current).toEqual([undefined]);
          stopCurrent();
          stop();
          const disconnected = cleanups[0];
          if (typeof disconnected === "function") disconnected();
          const stale: unknown[] = [];
          const stopStale = stream.subscribeFrame((_url, _bytes, metadata) => stale.push(metadata));
          expect(stale).toEqual([]);
          stopStale();
        } finally {
          URL.revokeObjectURL(secondUrl);
          URL.revokeObjectURL(ordinaryUrl);
        }
      } finally {
        URL.revokeObjectURL(first.url);
      }
    } finally {
      for (const cleanup of cleanups.reverse()) if (typeof cleanup === "function") cleanup();
      spies.forEach((spy) => spy.mockRestore());
    }
  }, "binary");
});

test.each(["binary", "json"] as const)(
  "gateway %s frames retain JPEG composition without changing bytes",
  async (format) => {
    await withTransport(async (transport, send) => {
      const nextFrame = () =>
        new Promise<{ url: string; bytes: number; metadata?: SimulatorComposition }>((resolve) => {
          const unsubscribe = transport.onStreamFrame((url, bytes, metadata) => {
            unsubscribe();
            resolve({ url, bytes, metadata });
          });
        });
      const composed = jpeg(composition);
      const pending = nextFrame();
      send(composed);
      const frame = await pending;
      try {
        expect(frame.metadata).toEqual(composition);
        expect(frame.bytes).toBe(composed.length);
        expect(
          Buffer.from(await (await fetch(frame.url)).arrayBuffer()).equals(Buffer.from(composed)),
        ).toBe(true);
      } finally {
        URL.revokeObjectURL(frame.url);
      }
      const ordinaryPending = nextFrame();
      send(jpeg());
      const ordinary = await ordinaryPending;
      try {
        expect(ordinary.metadata).toBeUndefined();
      } finally {
        URL.revokeObjectURL(ordinary.url);
      }
    }, format);
  },
);
