import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSimMiddleware } from "../middleware";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

const createdDirs: string[] = [];
const SELECTED = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
const OTHER = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function devices(selectedState: "Shutdown" | "Booted") {
  return {
    result: {
      stdout: JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-Test": [
            { udid: SELECTED, name: "Selected", state: selectedState },
            { udid: OTHER, name: "Other", state: "Booted" },
          ],
        },
      }),
    },
  };
}

describe("selected simulator attach-only reconnect", () => {
  test("waits while selected is shutdown, then attaches only after the user boots it", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "selected-reattach-"));
    createdDirs.push(stateDir);
    const host = createScriptedHostCommands([
      devices("Shutdown"),
      devices("Booted"),
      { result: { stdout: "/test/headless-serve-sim\n" } },
      {},
    ]);
    const handler = createSimMiddleware(host, {
      basePath: "/",
      serveSimBin: "/test/headless-serve-sim",
      stateDir,
    });
    const server = createServer((req, res) => handler(req, res, () => res.end("Not found")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const attach = () =>
      fetch(`${origin}/grid/api/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ udid: SELECTED }),
      });

    try {
      expect((await attach()).status).toBe(409);
      expect((await attach()).status).toBe(200);
      expect(host.calls.at(-1)).toEqual({
        kind: "start",
        request: {
          executable: "/test/headless-serve-sim",
          args: ["--detach", "--attach-only", SELECTED],
          stdio: "stream",
        },
      });
      expect(JSON.stringify(host.calls.at(-1)?.request)).not.toContain(OTHER);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
