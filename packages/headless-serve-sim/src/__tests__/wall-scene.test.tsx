import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WallScene, wallColumns, wallDevices } from "../client/scenes/wall-scene";
import * as gridDevices from "../client/hooks/use-grid-devices";
import type { GridDevice } from "../client/utils/grid";

const grid = (device: string, state: string, port: number | null): GridDevice => ({
  device,
  name: device,
  runtime: "iOS 26",
  state,
  helper: port
    ? {
        port,
        url: `http://localhost:${port}`,
        streamUrl: `http://localhost:${port}/stream.mjpeg`,
        wsUrl: `ws://localhost:${port}/ws`,
      }
    : null,
});

describe("wallDevices", () => {
  test("keeps running simulators, streaming ones first", () => {
    const list = [
      grid("IDLE", "Booted", null),
      grid("OFF", "Shutdown", null),
      grid("LIVE", "Booted", 3104),
    ];
    expect(wallDevices(list).map((d) => d.device)).toEqual(["LIVE", "IDLE"]);
  });
});

describe("wallColumns", () => {
  test("never more columns than tiles, more on wider walls", () => {
    expect(wallColumns(1, 1400)).toBe(1);
    expect(wallColumns(6, 1400)).toBe(4);
    expect(wallColumns(6, 900)).toBe(2);
    expect(wallColumns(6, 400)).toBe(1);
    expect(wallColumns(0, 900)).toBe(1);
  });
});

describe("WallScene", () => {
  function render(devices: GridDevice[]) {
    const spy = spyOn(gridDevices, "useGridDevices").mockReturnValue({
      devices,
      total: devices.length,
      hasMore: false,
      refresh() {},
      loadMore() {},
      loadAll() {},
      resetPage() {},
    });
    try {
      return renderToStaticMarkup(
        <WallScene currentUdid="LIVE" insetBottom={0} onFocus={() => {}} />,
      );
    } finally {
      spy.mockRestore();
    }
  }

  test("streams every live simulator and offers to stream idle ones", () => {
    const html = render([
      grid("LIVE", "Booted", 3104),
      grid("OTHER", "Booted", 3105),
      grid("IDLE", "Booted", null),
    ]);
    expect(html.match(/<img\b/g)?.length).toBe(2);
    expect(html).toContain("http://localhost:3104/stream.mjpeg");
    expect(html).toContain("http://localhost:3105/stream.mjpeg");
    expect(html).toContain(":3105");
    expect(html).toContain("Not streaming");
    expect(html).toContain(">Stream<");
    expect(html).toContain('aria-label="Shut down IDLE"');
  });

  test("says so when nothing is running", () => {
    expect(render([grid("OFF", "Shutdown", null)])).toContain("No simulators running");
  });
});
