import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchGatewayStatus } from "../discovery";

describe("fetchGatewayStatus", () => {
  let mockServer: ReturnType<typeof Bun.serve>;

  afterEach(() => {
    if (mockServer) mockServer.stop();
  });

  test("returns status when server responds correctly", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/status") {
          return Response.json({
            ok: true,
            version: "2.0.0",
            sessions: 3,
            maxSessions: 64,
            allowlist: ["echo *", "ls *"],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const status = await fetchGatewayStatus({
      baseUrl: `http://localhost:${mockServer.port}`,
    });

    expect(status).not.toBeNull();
    expect(status!.ok).toBe(true);
    expect(status!.version).toBe("2.0.0");
    expect(status!.sessions).toBe(3);
    expect(status!.maxSessions).toBe(64);
    expect(status!.allowlist).toEqual(["echo *", "ls *"]);
  });

  test("returns null when server returns non-200", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    const status = await fetchGatewayStatus({
      baseUrl: `http://localhost:${mockServer.port}`,
    });
    expect(status).toBeNull();
  });

  test("returns null when response body lacks 'ok' field", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/status") {
          return Response.json({ version: "1.0.0" }); // missing 'ok'
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const status = await fetchGatewayStatus({
      baseUrl: `http://localhost:${mockServer.port}`,
    });
    expect(status).toBeNull();
  });

  test("returns null when server is unreachable", async () => {
    const status = await fetchGatewayStatus({
      baseUrl: "http://localhost:1",
      timeout: 100,
    });
    expect(status).toBeNull();
  });

  test("strips trailing slash from baseUrl", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        // Ensure path is /status, not //status
        if (url.pathname === "/status") {
          return Response.json({
            ok: true,
            version: null,
            sessions: 0,
            maxSessions: 64,
            allowlist: [],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const status = await fetchGatewayStatus({
      baseUrl: `http://localhost:${mockServer.port}/`,
    });
    expect(status).not.toBeNull();
    expect(status!.ok).toBe(true);
  });

  test("uses default baseUrl", async () => {
    // Stub fetch: whatever happens to listen on this machine's port 7070 is irrelevant.
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
      Promise.reject(new Error("unreachable"))) as unknown as typeof fetch);
    try {
      expect(await fetchGatewayStatus()).toBeNull();
      expect(String(fetchSpy.mock.calls[0]![0])).toBe("http://localhost:7070/status");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("returns null on timeout", async () => {
    // Start a server that never responds
    mockServer = Bun.serve({
      port: 0,
      async fetch() {
        // Delay longer than the timeout
        await new Promise((r) => setTimeout(r, 5000));
        return new Response("too late");
      },
    });

    const status = await fetchGatewayStatus({
      baseUrl: `http://localhost:${mockServer.port}`,
      timeout: 50,
    });
    expect(status).toBeNull();
  });

  test("returns null when response is not valid JSON", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/status") {
          return new Response("not json", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const status = await fetchGatewayStatus({
      baseUrl: `http://localhost:${mockServer.port}`,
    });
    expect(status).toBeNull();
  });
});
