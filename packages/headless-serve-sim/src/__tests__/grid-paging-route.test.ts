import { describe, expect, test } from "bun:test";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { createSimMiddleware } from "../middleware";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

/** `simctl list devices -j` output with `count` iPhones on one runtime. */
function simctlList(count: number): string {
  return JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-18-0": Array.from({ length: count }, (_, i) => ({
        udid: `UDID-${String(i).padStart(3, "0")}`,
        name: `iPhone ${i}`,
        state: "Shutdown",
        isAvailable: true,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
      })),
    },
  });
}

interface GridResponse {
  devices: Array<{ device: string; name: string }>;
  total?: number;
  limit?: number;
  offset?: number;
}

async function fetchGrid(path: string, deviceCount: number): Promise<GridResponse> {
  // Every poll re-runs simctl, so script plenty of identical replies.
  const host = createScriptedHostCommands(
    Array.from({ length: 8 }, () => ({ result: { stdout: simctlList(deviceCount) } })),
  );
  const handler = createSimMiddleware(host, {
    basePath: "/",
    execToken: "t",
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
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    expect(res.status).toBe(200);
    return (await res.json()) as GridResponse;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("/grid/api pagination", () => {
  test("returns every device and no paging fields when limit is absent", async () => {
    // Embedded mounts rely on this shape; adding total/limit/offset
    // unconditionally would change the response for existing consumers.
    const body = await fetchGrid("/grid/api", 30);
    expect(body.devices.length).toBe(30);
    expect(body.total).toBeUndefined();
    expect(body.limit).toBeUndefined();
    expect(body.offset).toBeUndefined();
  });

  test("returns a page plus the full total when limit is given", async () => {
    const body = await fetchGrid("/grid/api?limit=10", 30);
    expect(body.devices.length).toBe(10);
    expect(body.total).toBe(30);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  test("offset walks the list without overlap", async () => {
    const first = await fetchGrid("/grid/api?limit=10&offset=0", 30);
    const second = await fetchGrid("/grid/api?limit=10&offset=10", 30);
    const firstIds = new Set(first.devices.map((d) => d.device));
    expect(second.devices.some((d) => firstIds.has(d.device))).toBe(false);
  });

  test("an offset past the end yields an empty page, not an error", async () => {
    const body = await fetchGrid("/grid/api?limit=10&offset=999", 30);
    expect(body.devices).toEqual([]);
    expect(body.total).toBe(30);
  });

  test("a limit larger than the catalog returns everything", async () => {
    const body = await fetchGrid("/grid/api?limit=500", 12);
    expect(body.devices.length).toBe(12);
    expect(body.total).toBe(12);
  });

  test("the selected device is on the first page", async () => {
    // Otherwise the preview can paginate away from the device it is streaming,
    // and its tile disappears from the panel.
    const body = await fetchGrid("/grid/api?limit=5&device=UDID-020", 30);
    expect(body.devices[0]?.device).toBe("UDID-020");
  });
});
