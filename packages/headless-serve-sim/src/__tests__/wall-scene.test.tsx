import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WallScene,
  duoTileCrop,
  wallColumns,
  wallDevices,
  wallLineupHeight,
} from "../client/scenes/wall-scene";
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

test("a Duo tile crops its composite to the device's bounds", () => {
  expect(duoTileCrop([0.25, 0.1, 0.5, 0.8], 1000, 1000)).toEqual({
    x: 250,
    y: 100,
    width: 500,
    height: 800,
  });
  // Never crops outside the frame.
  expect(duoTileCrop([-0.1, 0, 1.2, 1], 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
});

describe("wallLineupHeight", () => {
  test("narrow columns cap every phone to the widest body, so phones match", () => {
    // 291px columns: a slim phone could grow to 680px, the folded Duo only ~342px.
    const height = wallLineupHeight(291, 900);
    expect(height * 0.73).toBeLessThanOrEqual(291 * 0.86 + 0.5);
    expect(height).toBeGreaterThan(330);
  });
  test("tall rows stay height-limited", () => {
    expect(wallLineupHeight(600, 500)).toBeCloseTo((500 - 72) * 0.82);
  });
});
