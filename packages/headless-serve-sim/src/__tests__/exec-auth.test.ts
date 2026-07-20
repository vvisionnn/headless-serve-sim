import { describe, expect, test } from "bun:test";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { createSimMiddleware } from "../middleware";
import {
  createScriptedHostCommands,
  type ScriptedHostCommands,
} from "../test-support/scripted-host-commands";

async function withServer<T>(
  fn: (origin: string, host: ScriptedHostCommands) => Promise<T>,
  host = createScriptedHostCommands(),
): Promise<T> {
  const TOKEN = "test-token-abc123";
  const handler = createSimMiddleware(host, {
    basePath: "/",
    execToken: TOKEN,
    serveSimBin: "test-headless-serve-sim",
  });
  const server = createServer((req, res) => {
    handler(req, res, () => {
      if (!res.headersSent) res.statusCode = 404;
      res.end("Not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  try {
    return await fn(origin, host);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const TOKEN = "test-token-abc123";

describe("/exec auth", () => {
  test("rejects unauthenticated POST", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(401);
    });
  });

  test("rejects non-JSON Content-Type (CSRF-simple-POST path)", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(415);
    });
  });

  test("rejects cross-origin POST", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
          Origin: "http://evil.example",
        },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(403);
    });
  });

  test("rejects wrong bearer token", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-token" },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(401);
    });
  });

  test("accepts same-origin POST with bearer token", async () => {
    const host = createScriptedHostCommands([{ result: { stdout: "headless-serve-sim-test\n" } }]);
    await withServer(async (origin, commands) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
          Origin: origin,
        },
        body: JSON.stringify({ command: "echo headless-serve-sim-test" }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { stdout: string; exitCode: number };
      expect(body.stdout.trim()).toBe("headless-serve-sim-test");
      expect(body.exitCode).toBe(0);
      expect(commands.calls).toEqual([
        {
          kind: "run",
          request: {
            shell: "echo headless-serve-sim-test",
            stdio: "capture",
            maxOutputBytes: 16 * 1024 * 1024,
          },
        },
      ]);
      expect(commands.remaining).toBe(0);
    }, host);
  }, 30_000);
});

describe("/logs auth", () => {
  test("rejects missing and incorrect EventSource tokens before device lookup", async () => {
    await withServer(async (origin) => {
      for (const query of ["device=NOT-RUNNING", "device=NOT-RUNNING&token=wrong-token"]) {
        const response = await fetch(`${origin}/logs?${query}`);
        expect(response.status).toBe(401);
        expect(await response.text()).toBe("Unauthorized");
      }
    });
  });

  test("rejects an unsupported capture level before device lookup", async () => {
    await withServer(async (origin) => {
      const response = await fetch(`${origin}/logs?device=NOT-RUNNING&token=${TOKEN}&level=fault`);
      expect(response.status).toBe(400);
    });
  });

  test("rejects an invalid process identifier before device lookup", async () => {
    await withServer(async (origin) => {
      for (const processId of ["", "0", "-1", "1.5", "not-a-pid"]) {
        const response = await fetch(
          `${origin}/logs?device=NOT-RUNNING&token=${TOKEN}&processId=${encodeURIComponent(processId)}`,
        );
        expect(response.status).toBe(400);
        expect(await response.text()).toBe("Invalid process id");
      }
    });
  });
});
