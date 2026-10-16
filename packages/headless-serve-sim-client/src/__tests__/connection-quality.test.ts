import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionQuality } from "../transport";
import { waitFor } from "./wait-for";

/**
 * Tests for connection quality monitoring in GatewayTransport.
 *
 * We spin up a minimal WebSocket server that sends simulated stream:frame
 * messages at controlled intervals, then verify the transport correctly
 * classifies connection quality based on frame inter-arrival time.
 */

function startFrameServer(): {
  port: number;
  sendFrame: () => void;
  close: () => void;
  clients: Set<any>;
} {
  const clients = new Set<any>();
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined;
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
      },
      close(ws) {
        clients.delete(ws);
      },
      message() {},
    },
  });

  const sendFrame = () => {
    const msg = JSON.stringify({ type: "stream:frame", data: "AAAA" });
    for (const ws of clients) {
      ws.send(msg);
    }
  };

  return { port: server.port!, sendFrame, close: () => server.stop(), clients };
}

/** Deterministic clock: frame intervals are exact, independent of machine speed. */
let clock = 0;

async function createTransport(port: number) {
  const { GatewayTransport } = await import("../transport");
  const transport = new GatewayTransport({ url: `ws://localhost:${port}`, now: () => clock });
  await transport.waitForOpen();
  return transport;
}

describe("Connection quality", () => {
  let server: ReturnType<typeof startFrameServer>;
  let transport: Awaited<ReturnType<typeof createTransport>>;
  let received = 0;

  /** Sends `count` frames spaced `intervalMs` apart on the test clock. */
  async function sendFrames(count: number, intervalMs: number) {
    for (let i = 0; i < count; i++) {
      clock += intervalMs;
      const expected = received + 1;
      server.sendFrame();
      await waitFor(() => received >= expected);
    }
  }

  beforeEach(async () => {
    clock = 0;
    received = 0;
    server = startFrameServer();
    transport = await createTransport(server.port);
    transport.onStreamFrame(() => received++);
  });

  afterEach(() => {
    transport.close();
    server.close();
  });

  test("quality starts as null before any frames", () => {
    expect(transport.getConnectionQuality()).toBeNull();
  });

  test("quality is good with fast frames", async () => {
    const qualities: ConnectionQuality[] = [];
    transport.onConnectionQualityChange((q) => qualities.push(q));

    await sendFrames(12, 30); // well within the 100ms threshold

    expect(transport.getConnectionQuality()).toBe("good");
    expect(qualities.length).toBeGreaterThan(0);
    expect(qualities[qualities.length - 1]).toBe("good");
  });

  test("quality degrades with slow frames", async () => {
    const qualities: ConnectionQuality[] = [];
    transport.onConnectionQualityChange((q) => qualities.push(q));

    await sendFrames(12, 150); // between 100-250ms = degraded

    expect(transport.getConnectionQuality()).toBe("degraded");
    expect(qualities).toContain("degraded");
  });

  test("quality is poor with very slow frames", async () => {
    const qualities: ConnectionQuality[] = [];
    transport.onConnectionQualityChange((q) => qualities.push(q));

    await sendFrames(12, 300); // >250ms = poor

    expect(transport.getConnectionQuality()).toBe("poor");
    expect(qualities).toContain("poor");
  });

  test("quality transitions from good to poor as frames slow down", async () => {
    const qualities: ConnectionQuality[] = [];
    transport.onConnectionQualityChange((q) => qualities.push(q));

    await sendFrames(12, 30);
    expect(transport.getConnectionQuality()).toBe("good");

    await sendFrames(12, 300);
    expect(transport.getConnectionQuality()).toBe("poor");
    expect(qualities).toContain("good");
    expect(qualities).toContain("poor");
  });

  test("unsubscribe stops callbacks", async () => {
    const qualities: ConnectionQuality[] = [];
    const unsub = transport.onConnectionQualityChange((q) => qualities.push(q));

    await sendFrames(2, 30);
    unsub();
    await sendFrames(10, 300);

    expect(transport.getConnectionQuality()).toBe("poor");
    expect(qualities.filter((q) => q === "poor").length).toBe(0);
  });
});
