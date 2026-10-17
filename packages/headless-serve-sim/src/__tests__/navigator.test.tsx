import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Navigator,
  capacitySummary,
  groupSimulators,
  simRowState,
  type NavigatorProps,
} from "../client/shell/navigator";
import * as gridDevices from "../client/hooks/use-grid-devices";
import * as gridMemory from "../client/hooks/use-grid-memory";
import type { SimDevice } from "../client/utils/devices";
import type { GridDevice } from "../client/utils/grid";

const sim = (udid: string, name: string, runtime: string, state = "Shutdown"): SimDevice => ({
  udid,
  name,
  runtime,
  state,
});

const helper = (port: number): GridDevice["helper"] => ({
  port,
  url: `http://localhost:${port}`,
  streamUrl: `http://localhost:${port}/stream.mjpeg`,
  wsUrl: `ws://localhost:${port}/ws`,
});

describe("simRowState", () => {
  test("a helper means live, and carries its port", () => {
    expect(simRowState(sim("A", "iPhone", "iOS 26", "Booted"), helper(3104), false, false)).toEqual(
      {
        kind: "live",
        port: 3104,
      },
    );
  });

  test("booted without a helper is booted, not streaming", () => {
    expect(simRowState(sim("A", "iPhone", "iOS 26", "Booted"), null, false, false)).toEqual({
      kind: "booted",
    });
  });

  test("simctl's Booting and a pending start both read as booting", () => {
    expect(simRowState(sim("A", "iPhone", "iOS 26", "Booting"), null, false, false).kind).toBe(
      "booting",
    );
    expect(simRowState(sim("A", "iPhone", "iOS 26"), null, false, true).kind).toBe("booting");
  });

  test("stopping wins over every other state", () => {
    expect(simRowState(sim("A", "iPhone", "iOS 26", "Booted"), helper(1), true, false).kind).toBe(
      "stopping",
    );
  });

  test("anything else is shut down", () => {
    expect(simRowState(sim("A", "iPhone", "iOS 26"), null, false, false).kind).toBe("shutdown");
  });
});

describe("groupSimulators", () => {
  const devices = [
    sim("W", "Apple Watch Ultra 3", "watchOS 26"),
    sim("P2", "iPhone Air", "iOS 26"),
    sim("T", "iPad Pro 13-inch (M5)", "iOS 26"),
    sim("P1", "iPhone 17 Pro", "iOS 26"),
  ];

  test("groups by runtime in platform order, phones before tablets, then by name", () => {
    expect(groupSimulators(devices, "").map(([r, l]) => [r, l.map((d) => d.udid)])).toEqual([
      ["iOS 26", ["P1", "P2", "T"]],
      ["watchOS 26", ["W"]],
    ]);
  });

  test("search matches name or runtime, case-insensitively", () => {
    expect(groupSimulators(devices, "AIR").flatMap(([, l]) => l.map((d) => d.udid))).toEqual([
      "P2",
    ]);
    expect(groupSimulators(devices, "watchos").flatMap(([, l]) => l.map((d) => d.udid))).toEqual([
      "W",
    ]);
  });
});

describe("capacitySummary", () => {
  test("capacity is what runs now plus what still fits", () => {
    expect(
      capacitySummary(
        {
          totalBytes: 32 * 1024 ** 3,
          availableBytes: 12.4 * 1024 ** 3,
          runningSimulators: 3,
          perSimAvgBytes: 2 * 1024 ** 3,
          perSimSource: "measured",
          estimatedAdditional: 2,
        },
        0,
      ),
    ).toEqual({ running: 3, capacity: 5, free: "12 GB", tone: "ink" });
  });

  test("warns as room runs out", () => {
    const report = {
      totalBytes: 16 * 1024 ** 3,
      availableBytes: 1024 ** 3,
      runningSimulators: 2,
      perSimAvgBytes: 1024 ** 3,
      perSimSource: "estimated" as const,
      estimatedAdditional: 1,
    };
    expect(capacitySummary(report, 0).tone).toBe("orange");
    expect(capacitySummary({ ...report, estimatedAdditional: 0 }, 0).tone).toBe("red");
  });

  test("without a memory report, counts booted simulators and draws no meter", () => {
    expect(capacitySummary(null, 2)).toEqual({
      running: 2,
      capacity: null,
      free: null,
      tone: "ink",
    });
  });
});

describe("Navigator", () => {
  const props: NavigatorProps = {
    devices: [
      sim("LIVE", "iPhone 17 Pro", "iOS 26", "Booted"),
      sim("IDLE", "iPhone Air", "iOS 26", "Booted"),
      sim("OFF", "iPad Pro 13-inch (M5)", "iOS 26"),
      sim("STOP", "iPhone 16e", "iOS 26", "Booted"),
    ],
    loading: false,
    error: null,
    currentUdid: "LIVE",
    stoppingUdids: new Set(["STOP"]),
    switching: false,
    onRefresh() {},
    onSelect() {},
    onStop() {},
  };

  function render(p: NavigatorProps = props) {
    const grid = spyOn(gridDevices, "useGridDevices").mockReturnValue({
      devices: [
        {
          device: "LIVE",
          name: "iPhone 17 Pro",
          runtime: "iOS 26",
          state: "Booted",
          helper: helper(3104),
        },
      ],
      total: 1,
      hasMore: false,
      refresh() {},
      loadMore() {},
      loadAll() {},
      resetPage() {},
    });
    const memory = spyOn(gridMemory, "useGridMemory").mockReturnValue({
      totalBytes: 32 * 1024 ** 3,
      availableBytes: 12.4 * 1024 ** 3,
      runningSimulators: 3,
      perSimAvgBytes: 2 * 1024 ** 3,
      perSimSource: "measured",
      estimatedAdditional: 2,
    });
    try {
      return renderToStaticMarkup(<Navigator {...p} />);
    } finally {
      grid.mockRestore();
      memory.mockRestore();
    }
  }

  test("shows every simulator's live state", () => {
    const html = render();
    expect(html).toContain("Simulators");
    expect(html).toContain(":3104");
    expect(html).toContain("Booted · not streaming");
    expect(html).toContain("Shut down");
    expect(html).toContain("Stopping…");
  });

  test("offers boot for shut-down devices and stop for booted ones", () => {
    const html = render();
    expect(html).toContain('aria-label="Boot iPad Pro 13-inch (M5)"');
    expect(html).toContain('aria-label="Shut down iPhone Air"');
    expect(html).not.toContain('aria-label="Shut down iPhone 16e"');
  });

  test("labels runtime groups for reading, not as simctl spells them", () => {
    const html = render({ ...props, devices: [sim("X", "iPhone Air", "iOS.27.0")] });
    expect(html).toContain("iOS 27.0");
    expect(html).not.toContain("iOS.27.0");
  });

  test("reports capacity in the footer", () => {
    const html = render();
    expect(html).toContain("3 of 5 running");
    expect(html).toContain("12 GB free");
  });

  test("surfaces a listing error and an empty catalog", () => {
    expect(render({ ...props, error: "simctl failed" })).toContain("simctl failed");
    expect(render({ ...props, devices: [] })).toContain("No simulators found");
  });
});
