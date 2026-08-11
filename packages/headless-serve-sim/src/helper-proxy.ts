import { Readable, type Duplex } from "stream";
import { pipeline } from "stream/promises";
import type { IncomingMessage, ServerResponse } from "http";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Same-origin proxy to a device's stream helper.
 *
 * Each helper listens on its own port, so a preview served over a LAN address
 * or a tunnel normally needs *two* reachable ports — the preview's and the
 * helper's — and the second one is easy to forget to forward. With proxying
 * on, the page talks only to the preview origin and this forwards to the
 * helper.
 *
 * The WebSocket side relays through a real client rather than splicing the two
 * TCP sockets. Splicing is cheaper — nothing here needs to read frames — but
 * Bun's `node:http` upgrade socket does not deliver raw writes back to the
 * client, so the helper's 101 never reaches the browser. Verified: the spliced
 * version works under Node and hangs under Bun, and the shipped binary is
 * `bun build --compile`.
 */

/** `<base>/helper/<udid>/<rest>` → the udid and the helper-relative path. */
export function parseHelperProxyPath(
  base: string,
  url: string,
): { device: string; path: string } | null {
  const prefix = `${base}/helper/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slash = rest.indexOf("/");
  const device = slash === -1 ? rest : rest.slice(0, slash);
  if (!device) return null;
  const path = slash === -1 ? "/" : rest.slice(slash);
  let decoded: string;
  try {
    decoded = decodeURIComponent(device);
  } catch {
    // A malformed escape (`/helper/%/ws`) must not throw out of the request or
    // upgrade handler and take the process with it.
    return null;
  }
  return { device: decoded, path: path || "/" };
}

/** Same-origin base URL the page should use for a proxied helper. */
export function helperProxyBase(base: string, device: string): string {
  return `${base}/helper/${encodeURIComponent(device)}`;
}

/**
 * Rewrite a helper's absolute URLs to same-origin proxy paths.
 *
 * `wsUrl` keeps its scheme relative to how the page was reached: behind a TLS
 * terminator the page is https, so the socket has to be wss or the browser
 * blocks it as mixed content.
 */
export function proxiedHelperUrls(
  base: string,
  device: string,
  opts: { host: string; secure: boolean },
): { url: string; streamUrl: string; wsUrl: string } {
  const path = helperProxyBase(base, device);
  const httpOrigin = `${opts.secure ? "https" : "http"}://${opts.host}`;
  const wsOrigin = `${opts.secure ? "wss" : "ws"}://${opts.host}`;
  return {
    url: `${httpOrigin}${path}`,
    streamUrl: `${httpOrigin}${path}/stream.mjpeg`,
    wsUrl: `${wsOrigin}${path}/ws`,
  };
}

/** Whether the request reached us over TLS, honoring a terminating proxy. */
export function requestIsSecure(headers: Record<string, unknown>): boolean {
  const forwarded = headers["x-forwarded-proto"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value === "string") return value.split(",")[0]!.trim() === "https";
  return false;
}

/** Forward an HTTP request to the helper and stream the response back. */
export async function proxyHelperRequest(
  helperOrigin: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const target = `${helperOrigin}${path}`;
  const controller = new AbortController();
  // A viewer navigating away must tear down the upstream stream too, or the
  // helper keeps encoding frames for a reader that has gone.
  res.on("close", () => controller.abort());
  try {
    const upstream = await fetch(target, {
      method: req.method ?? "GET",
      headers: { accept: String(req.headers.accept ?? "*/*") },
      signal: controller.signal,
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers["Content-Type"] = contentType;
    res.writeHead(upstream.status, headers);
    if (!upstream.body) {
      res.end();
      return;
    }
    // Piping honors backpressure: a viewer reading slower than the helper
    // encodes (a tunnel, a remote browser) must throttle the upstream read
    // instead of letting Node buffer video without bound.
    await pipeline(Readable.from(upstream.body), res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Helper unavailable" }));
    } else {
      res.end();
    }
  }
}

/**
 * Relay a client upgrade to the helper's WebSocket.
 *
 * Returns a function so the `ws` server is created once per middleware rather
 * than per connection.
 */
export function createHelperSocketProxy() {
  const wss = new WebSocketServer({ noServer: true });
  return function tunnel(
    helperWsUrl: string,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(helperWsUrl);
      // The browser can send before the upstream leg finishes connecting;
      // dropping those would lose the first input of a session.
      const pending: Array<{ data: Buffer; binary: boolean }> = [];

      const closeBoth = () => {
        if (client.readyState === WebSocket.OPEN) client.close();
        if (
          upstream.readyState === WebSocket.OPEN ||
          upstream.readyState === WebSocket.CONNECTING
        ) {
          upstream.close();
        }
      };

      client.on("message", (data, isBinary) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(buffer, { binary: isBinary });
        } else {
          pending.push({ data: buffer, binary: isBinary });
        }
      });
      upstream.on("open", () => {
        for (const message of pending.splice(0)) {
          upstream.send(message.data, { binary: message.binary });
        }
      });
      upstream.on("message", (data, isBinary) => {
        if (client.readyState !== WebSocket.OPEN) return;
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        client.send(buffer, { binary: isBinary });
      });

      client.on("close", closeBoth);
      upstream.on("close", closeBoth);
      client.on("error", closeBoth);
      upstream.on("error", closeBoth);
    });
  };
}
