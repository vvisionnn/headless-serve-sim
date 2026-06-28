import { simEndpoint } from "./sim-endpoint";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Existing in-page tools shell out over POST /exec (bearer-token, same-origin).
// This path is deliberately preserved; only the simulator-settings panel uses
// the WebSocket control channel below.
export async function execOnHost(command: string): Promise<ExecResult> {
  const token = window.__SIM_PREVIEW__?.execToken;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(simEndpoint("exec"), {
    method: "POST",
    headers,
    body: JSON.stringify({ command }),
  });
  return res.json();
}

// ─── Simulator-settings control socket (`/exec-ws`) ───
//
// The settings panel issues rapid, in-process requests (one per toggle/slider
// step). Routing them over a single WebSocket keeps them off the browser's
// six-connections-per-origin HTTP pool, which the MJPEG + SSE streams already
// saturate with multiple tabs open. Only this feature uses the socket; every
// other tool keeps using POST /exec above.

const CONNECT_TIMEOUT_MS = 5_000;

type SocketReply = {
  id?: number;
  ready?: boolean;
  error?: string;
  status?: Record<string, string>;
  ok?: boolean;
};

interface PendingRequest {
  resolve: (reply: SocketReply) => void;
  reject: (err: unknown) => void;
}

let socketPromise: Promise<WebSocket> | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function execSocketUrl(): string {
  const url = new URL(simEndpoint("exec-ws"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function rejectAllPending(reason: Error): void {
  for (const pending of pendingRequests.values()) pending.reject(reason);
  pendingRequests.clear();
}

// The page bakes the exec token at load, but the server mints a fresh one on
// every process start. After a server restart (a Metro/Expo reload, a helper
// recycle, simctl churn) the baked token is stale, the socket's auth frame is
// rejected, and the channel closes — the "control socket closed" the user used
// to escape only by reloading the page. Pull the live token from /api (which
// always reflects the running server) so the socket can re-auth itself.
async function fetchLiveExecToken(): Promise<string | null> {
  try {
    const url = new URL(simEndpoint("api"), window.location.href);
    const device =
      new URLSearchParams(window.location.search).get("device") ??
      window.__SIM_PREVIEW__?.device ??
      "";
    if (device) url.searchParams.set("device", device);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const cfg = (await res.json()) as { execToken?: string } | null;
    const token = cfg?.execToken;
    if (typeof token === "string" && token) {
      if (window.__SIM_PREVIEW__) window.__SIM_PREVIEW__.execToken = token;
      return token;
    }
  } catch {
    // Server may be mid-restart; the caller surfaces the original error.
  }
  return null;
}

// One connect + auth attempt with a single token. Resolves when the server
// accepts it ({ready:true}); rejects on a failed handshake, rejected auth, or
// timeout. A drop AFTER auth clears the cached socket and fails in-flight
// requests so the next call reconnects; the pre-auth phase leaves socketPromise
// to openExecSocket, which owns the token refresh + retry.
function connectExecSocket(token: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    let authed = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(execSocketUrl());
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // Fail fast if the server never completes the handshake or auth — a hung
    // connection must not stall every request behind it.
    const connectTimer = setTimeout(() => {
      if (!authed) {
        reject(new Error("control socket connect timeout"));
        ws.close();
      }
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify({ token }));
    ws.onmessage = (event) => {
      let msg: SocketReply;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.ready) {
        if (!authed) {
          authed = true;
          clearTimeout(connectTimer);
          resolve(ws);
        }
        return;
      }
      if (typeof msg.id !== "number") return;
      const pending = pendingRequests.get(msg.id);
      if (!pending) return;
      pendingRequests.delete(msg.id);
      pending.resolve(msg);
    };
    const onDown = () => {
      clearTimeout(connectTimer);
      if (authed) {
        socketPromise = null;
        rejectAllPending(new Error("control socket closed — reload the page if this persists"));
      } else {
        reject(new Error("control socket closed before auth"));
      }
    };
    ws.onerror = onDown;
    ws.onclose = onDown;
  });
}

function openExecSocket(): Promise<WebSocket> {
  socketPromise ??= (async () => {
    const baked = window.__SIM_PREVIEW__?.execToken ?? "";
    try {
      return await connectExecSocket(baked);
    } catch (firstErr) {
      // The handshake failed — most often a stale token after a server
      // restart. Refetch the live token and retry once before surfacing the
      // error, so the control socket self-heals without a manual page reload.
      const fresh = await fetchLiveExecToken();
      if (fresh && fresh !== baked) return await connectExecSocket(fresh);
      throw firstErr instanceof Error
        ? firstErr
        : new Error("control socket closed — reload the page if this persists");
    }
  })().catch((err: unknown) => {
    // Drop the cache so the next request starts a fresh connect attempt.
    socketPromise = null;
    throw err;
  });
  return socketPromise;
}

async function socketRequest(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SocketReply> {
  const ws = await openExecSocket();
  if (ws.readyState !== WebSocket.OPEN) throw new Error("control socket not open");
  return new Promise<SocketReply>((resolve, reject) => {
    const id = nextRequestId++;
    const onAbort = () => {
      pendingRequests.delete(id);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    pendingRequests.set(id, {
      resolve: (reply) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(reply);
      },
      reject: (err) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    });
    ws.send(JSON.stringify({ id, ...body }));
  });
}

export interface UiRequestPayload {
  device: string;
  option?: string;
  value?: string;
}

/**
 * Simulator-settings request, handled in-process by the preview server (just
 * the underlying simctl/ax-tool spawn — no `node <cli>` shell round-trip).
 * Resolves to the settings map for status requests; rejects with the server's
 * error message for invalid requests or failed sets.
 */
export async function hostUiRequest(
  payload: UiRequestPayload,
  opts?: { signal?: AbortSignal },
): Promise<Record<string, string> | null> {
  const reply = await socketRequest({ ui: payload }, opts?.signal);
  if (reply.error) throw new Error(reply.error);
  return reply.status ?? null;
}

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
