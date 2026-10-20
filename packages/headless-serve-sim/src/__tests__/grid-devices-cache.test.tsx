import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GRID_MAX_PAGE_SIZE,
  fetchGrid,
  gridPageUrl,
  useGridDevices,
} from "../client/hooks/use-grid-devices";

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function serve(devices: unknown[]) {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => (resolve = r));
  const spy = spyOn(globalThis, "fetch").mockImplementation((async () => {
    await gate;
    return new Response(JSON.stringify({ devices, total: devices.length }));
  }) as unknown as typeof fetch);
  spies.push(spy);
  return { spy, release: resolve };
}

const device = (udid: string) => ({
  device: udid,
  name: udid,
  runtime: "iOS 26",
  state: "Booted",
  helper: null,
});

describe("fetchGrid", () => {
  test("pollers share the request in flight", async () => {
    const { spy, release } = serve([device("A")]);
    const url = "/grid/api?share";
    const first = fetchGrid(url);
    const second = fetchGrid(url);
    expect(second).toBe(first);
    release();
    expect((await first)?.devices.map((d) => d.device)).toEqual(["A"]);
    expect(spy).toHaveBeenCalledTimes(1);
    // Once settled, the next poll asks again.
    void fetchGrid(url);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("useGridDevices", () => {
  function Probe({ endpoint }: { endpoint: string }) {
    const { devices } = useGridDevices(endpoint, true, false, GRID_MAX_PAGE_SIZE);
    return <>{devices === null ? "loading" : devices.map((d) => d.device).join(",")}</>;
  }

  test("a fresh mount renders the last answer on its first pass", async () => {
    const endpoint = "/grid/api?seeded";
    expect(renderToStaticMarkup(<Probe endpoint={endpoint} />)).toBe("loading");
    const { release } = serve([device("A"), device("B")]);
    release();
    await fetchGrid(gridPageUrl(endpoint, GRID_MAX_PAGE_SIZE));
    expect(renderToStaticMarkup(<Probe endpoint={endpoint} />)).toBe("A,B");
  });
});
