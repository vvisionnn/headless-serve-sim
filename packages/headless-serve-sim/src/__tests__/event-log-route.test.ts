import { describe, expect, test } from "bun:test";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { createSimMiddleware } from "../middleware";
import { createEventLog, type EventLogEntry } from "../event-log";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const TOKEN = "event-log-token";

async function withServer<T>(
  fn: (origin: string, log: ReturnType<typeof createEventLog>) => Promise<T>,
): Promise<T> {
  const eventLog = createEventLog();
  const handler = createSimMiddleware(createScriptedHostCommands(), {
    basePath: "/",
    execToken: TOKEN,
    serveSimBin: "test-headless-serve-sim",
    eventLog,
  });
  const server = createServer((req, res) => {
    handler(req, res, () => {
      if (!res.headersSent) res.statusCode = 404;
      res.end("Not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`, eventLog);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function post(origin: string, body: unknown, token = TOKEN): Promise<Response> {
  return fetch(`${origin}/events/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe("POST /events/log", () => {
  test("records reported events", async () => {
    await withServer(async (origin, log) => {
      const res = await post(origin, {
        events: [{ source: "hid", kind: "tap", details: { x: 0.5, y: 0.5 } }],
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, accepted: 1 });
      expect(log.list().map((e) => e.kind)).toEqual(["tap"]);
    });
  });

  // Anything that can write here forges history the CLI prints as fact.
  test("rejects an unauthenticated report", async () => {
    await withServer(async (origin, log) => {
      const res = await fetch(`${origin}/events/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ source: "hid", kind: "tap" }] }),
      });
      expect(res.status).toBe(401);
      expect(log.size).toBe(0);
    });
  });

  test("rejects a wrong token", async () => {
    await withServer(async (origin, log) => {
      expect((await post(origin, { events: [] }, "nope")).status).toBe(401);
      expect(log.size).toBe(0);
    });
  });

  // One malformed entry in a batch must not discard the good ones alongside it.
  test("skips malformed entries and keeps the rest of the batch", async () => {
    await withServer(async (origin, log) => {
      const res = await post(origin, {
        events: [{ source: "hid", kind: "tap" }, { nope: true }, { source: "hid", kind: "button" }],
      });
      expect(await res.json()).toEqual({ ok: true, accepted: 2 });
      expect(log.list().map((e) => e.kind)).toEqual(["tap", "button"]);
    });
  });

  test("survives a malformed body", async () => {
    await withServer(async (origin, log) => {
      const res = await fetch(`${origin}/events/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: "not json",
      });
      expect(res.status).toBe(200);
      expect(log.size).toBe(0);
    });
  });

  test("coerces an unknown source rather than trusting it", async () => {
    await withServer(async (origin, log) => {
      await post(origin, { events: [{ source: "evil", kind: "tap" }] });
      expect(log.list()[0]?.source).toBe("hid");
    });
  });
});

describe("GET /events/log", () => {
  test("reads back over loopback without a token", async () => {
    // The CLI is a local shell with the same privileges as the user; requiring
    // a token it has no way to obtain would make `events` unusable.
    await withServer(async (origin, log) => {
      log.append({ source: "hid", kind: "tap", details: { x: 0.5, y: 0.5 } });
      const res = await fetch(`${origin}/events/log`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { events: EventLogEntry[] };
      expect(body.events.map((e) => e.msg)).toEqual(["Tap (0.500, 0.500)"]);
    });
  });

  test("`after` returns only newer entries", async () => {
    await withServer(async (origin, log) => {
      const first = log.append({ source: "hid", kind: "a" });
      log.append({ source: "hid", kind: "b" });
      const res = await fetch(`${origin}/events/log?after=${first.id}`);
      const body = (await res.json()) as { events: EventLogEntry[] };
      expect(body.events.map((e) => e.kind)).toEqual(["b"]);
    });
  });

  test("ignores a malformed `after` instead of erroring", async () => {
    await withServer(async (origin, log) => {
      log.append({ source: "hid", kind: "a" });
      const res = await fetch(`${origin}/events/log?after=abc`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { events: EventLogEntry[] }).events.length).toBe(1);
    });
  });
});
