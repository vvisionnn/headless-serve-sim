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

function openExecSocket(): Promise<WebSocket> {
  socketPromise ??= new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(execSocketUrl());
    } catch (e) {
      socketPromise = null;
      reject(e);
      return;
    }
    // Fail fast if the server never completes the handshake or auth — a hung
    // connection must not stall every request behind it.
    const connectTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socketPromise = null;
        reject(new Error("control socket connect timeout"));
        ws.close();
      }
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      ws.send(JSON.stringify({ token: window.__SIM_PREVIEW__?.execToken ?? "" }));
    };
    ws.onmessage = (event) => {
      let msg: SocketReply;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.ready) {
        if (!settled) {
          settled = true;
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
    const fail = () => {
      socketPromise = null;
      const err = new Error("control socket closed — reload the page if this persists");
      rejectAllPending(err);
      if (!settled) {
        settled = true;
        clearTimeout(connectTimer);
        reject(err);
      }
    };
    ws.onerror = fail;
    ws.onclose = fail;
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
