import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSimMiddleware } from "../middleware";
import { servePreview, type PreviewServer } from "../runtime";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

// The settings sidebar talks to the host over this WebSocket control channel
// (`/exec-ws`); existing tools keep using POST /exec. This suite runs under
// `bun test`, which is exactly the runtime where hand-rolled RFC6455 framing
// silently failed before: node:http under Bun emits `upgrade` but never
// flushes raw handshake bytes, which is why the channel is built on `ws`
// (Bun substitutes its native implementation).
//
// NOTE: this fork wires the channel with an EMPTY SSE allowlist
// (`ssePrefixes: []`) — we deliberately do NOT bridge SSE over the socket and
// keep our EventSource side-channels — so every `{sub, path}` request is
// rejected. The rejection test below guards that decision.

const PORT = 3461;
const TOKEN = "exec-ws-test-token";

let server: PreviewServer;
const hostCommands = createScriptedHostCommands([{ result: { stdout: "channel-works\n" } }]);

beforeAll(async () => {
  const middleware = createSimMiddleware(hostCommands, {
    basePath: "/",
    execToken: TOKEN,
    serveSimBin: "test-headless-serve-sim",
  });
  server = await servePreview({ port: PORT, middleware, host: "127.0.0.1" });
}, 60_000);

afterAll(async () => {
  // Let any client socket from the last test finish its async close before the
  // (graceful) server stop, so a late teardown reset can't surface as a stray
  // unhandled rejection that fails the run.
  await new Promise((r) => setTimeout(r, 50));
  server?.stop(true);
}, 60_000);

interface Reply {
  ready?: boolean;
  id?: number;
  stdout?: string;
  exitCode?: number;
  error?: string;
  sub?: number;
  end?: boolean;
}

function connect(token: string): Promise<{
  next: () => Promise<Reply>;
  send: (body: Record<string, unknown>) => void;
  close: () => void;
  closed: Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/exec-ws`);
    const queue: Reply[] = [];
    const waiters: Array<(r: Reply) => void> = [];
    let settled = false;
    let closeResolve: () => void;
    const closed = new Promise<void>((r) => {
      closeResolve = r;
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("connect timeout"));
    }, 30_000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ token }));
      if (settled) return;
      settled = true;
      resolve({
        next: () =>
          new Promise<Reply>((r, rej) => {
            const queued = queue.shift();
            if (queued) return r(queued);
            const bail = setTimeout(() => rej(new Error("reply timeout")), 30_000);
            waiters.push((reply) => {
              clearTimeout(bail);
              r(reply);
            });
          }),
        send: (body) => ws.send(JSON.stringify(body)),
        close: () => ws.close(),
        closed,
      });
    };
    ws.onmessage = (event) => {
      const reply = JSON.parse(String(event.data)) as Reply;
      const waiter = waiters.shift();
      if (waiter) waiter(reply);
      else queue.push(reply);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error("socket error"));
    };
    ws.onclose = () => closeResolve();
  });
}

describe("exec-ws control channel", () => {
  test("authenticates and runs a shell exec", async () => {
    const channel = await connect(TOKEN);
    expect((await channel.next()).ready).toBe(true);
    channel.send({ id: 1, command: "echo channel-works" });
    const reply = await channel.next();
    expect(reply.id).toBe(1);
    expect(reply.exitCode).toBe(0);
    expect(reply.stdout?.trim()).toBe("channel-works");
    expect(hostCommands.calls).toEqual([
      {
        kind: "run",
        request: {
          shell: "echo channel-works",
          maxOutputBytes: 16 * 1024 * 1024,
        },
      },
    ]);
    expect(hostCommands.remaining).toBe(0);
    channel.close();
  });

  test("rejects a bad token by closing the socket", async () => {
    const channel = await connect("wrong-token");
    await channel.closed;
  });

  test("ui requests validate their payload (bad udid)", async () => {
    const channel = await connect(TOKEN);
    await channel.next(); // ready
    channel.send({ id: 2, ui: { device: "not a udid!!", option: "appearance" } });
    const reply = await channel.next();
    expect(reply.id).toBe(2);
    expect(reply.error).toMatch(/invalid device/i);
    channel.close();
  });

  test("ui requests reject an unknown option", async () => {
    const channel = await connect(TOKEN);
    await channel.next(); // ready
    channel.send({
      id: 3,
      ui: { device: "0D7A14E3-0000-0000-0000-000000000000", option: "sound", value: "50" },
    });
    const reply = await channel.next();
    expect(reply.id).toBe(3);
    expect(reply.error).toMatch(/unknown option/i);
    channel.close();
  });

  test("SSE-over-WS is disabled in this build (empty allowlist)", async () => {
    const channel = await connect(TOKEN);
    await channel.next(); // ready
    // Even a plausible middleware route is refused: this fork keeps SSE on its
    // own EventSource channels and does not bridge them over the control socket.
    channel.send({ sub: 9, path: "/api/events" });
    const reply = await channel.next();
    expect(reply.sub).toBe(9);
    expect(reply.end).toBe(true);
    expect(reply.error).toMatch(/not allowed/i);
    channel.close();
  });
});
