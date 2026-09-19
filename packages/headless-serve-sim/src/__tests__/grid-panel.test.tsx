import { expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GridPanel } from "../client/components/grid-panel";
import * as gridDevices from "../client/hooks/use-grid-devices";

test("closing the grid removes every cached MJPEG preview; reopening restores them", () => {
  const devices = ["IPHONE", "IPAD"].map((device, index) => ({
    device,
    name: device,
    runtime: "iOS-26-0",
    state: "Booted",
    helper: {
      port: 3100 + index,
      url: `http://localhost:${3100 + index}`,
      streamUrl: `http://localhost:${3100 + index}/stream.mjpeg`,
      wsUrl: `ws://localhost:${3100 + index}/ws`,
    },
  }));
  const cached = spyOn(gridDevices, "useGridDevices").mockReturnValue({
    devices,
    total: devices.length,
    hasMore: false,
    refresh() {},
    loadMore() {},
    loadAll() {},
    resetPage() {},
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const render = (open: boolean) =>
    renderToStaticMarkup(
      <GridPanel open={open} onClose={() => {}} currentUdid="IPHONE" width={640} />,
    );

  try {
    for (const open of [true, false, true]) {
      const html = render(open);
      expect(html.match(/<img\b/g)?.length ?? 0).toBe(open ? devices.length : 0);
      for (const device of devices) {
        expect(html.includes(device.helper.streamUrl)).toBe(open);
      }
    }
  } finally {
    cached.mockRestore();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
