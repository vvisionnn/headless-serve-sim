import { describe, expect, test } from "bun:test";
import { createAxStreamerCache } from "../ax";

describe("createAxStreamerCache", () => {
  test("get() reuses the same streamer for a udid and retargets the port", () => {
    const cache = createAxStreamerCache();
    const a = cache.get("UDID-1", 4001);
    const b = cache.get("UDID-1", 4002);
    expect(a).toBe(b);
    expect(cache.size()).toBe(1);
  });

  test("prune() drops streamers for udids no longer active", () => {
    const cache = createAxStreamerCache();
    cache.get("UDID-A", 4001);
    cache.get("UDID-B", 4002);
    cache.get("UDID-C", 4003);
    expect(cache.size()).toBe(3);

    cache.prune(["UDID-A", "UDID-C"]);
    expect(cache.size()).toBe(2);

    cache.prune([]);
    expect(cache.size()).toBe(0);
  });

  test("a streamer disposed via prune() no longer accepts clients", () => {
    const cache = createAxStreamerCache();
    const streamer = cache.get("UDID-X", 4001);
    cache.prune([]);

    // Disposed streamer's addClient returns a no-op cleanup and never
    // pushes data — verifies it won't keep poll timers alive after prune.
    const writes: string[] = [];
    const removeClient = streamer.addClient({ write: (s) => writes.push(s) });
    expect(typeof removeClient).toBe("function");
    expect(writes).toEqual([]);
    removeClient();
  });
});

describe("helper /ax request", () => {
  const node = (frame: { width: number; height: number }, children: unknown[] = []) => ({
    AXUniqueId: null,
    AXLabel: "x",
    AXValue: null,
    enabled: true,
    frame: { x: 0, y: 0, ...frame },
    role_description: "",
    type: "Button",
    children,
  });

  async function firstSnapshot(root: Record<string, unknown>) {
    const urls: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        urls.push(req.url);
        return Response.json([root]);
      },
    });
    const cache = createAxStreamerCache();
    try {
      const streamer = cache.get("UDID-AX", server.port!);
      const message = await new Promise<string>((resolve) => {
        streamer.addClient({ write: resolve });
      });
      return { url: new URL(urls[0]!), snapshot: JSON.parse(message.slice("data: ".length)) };
    } finally {
      cache.prune([]);
      await server.stop(true);
    }
  }

  test("asks the helper to stop walking before the snapshot request aborts", async () => {
    const { url } = await firstSnapshot(
      node({ width: 400, height: 800 }, [node({ width: 40, height: 40 })]),
    );
    expect(url.pathname).toBe("/ax");
    expect(Number(url.searchParams.get("timeoutMs"))).toBe(3000);
  });

  test("marks a snapshot truncated when the helper hit its deadline", async () => {
    const { snapshot } = await firstSnapshot({
      ...node({ width: 400, height: 800 }, [node({ width: 40, height: 40 })]),
      truncated: true,
    });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.elements).toHaveLength(1);
  });

  test("leaves a complete snapshot unmarked", async () => {
    const { snapshot } = await firstSnapshot(
      node({ width: 400, height: 800 }, [node({ width: 40, height: 40 })]),
    );
    expect(snapshot.truncated).toBeUndefined();
  });
});
