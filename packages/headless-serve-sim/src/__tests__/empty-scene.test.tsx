import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyScene, detachCommand, emptySceneOrder } from "../client/scenes/empty-scene";
import type { SimDevice } from "../client/utils/devices";

const sim = (udid: string, name: string, state = "Shutdown", runtime = "iOS 26"): SimDevice => ({
  udid,
  name,
  state,
  runtime,
});

describe("EmptyScene", () => {
  const devices = [
    sim("PAD", "iPad Pro 13-inch (M5)"),
    sim("AIR", "iPhone Air"),
    sim("BOOTED", "iPhone 17 Pro", "Booted"),
    sim("WATCH", "Apple Watch Ultra 3", "Shutdown", "watchOS 26"),
  ];

  test("booted simulators first, then phones, tablets and watches", () => {
    expect(emptySceneOrder(devices).map((d) => d.udid)).toEqual(["BOOTED", "AIR", "PAD", "WATCH"]);
  });

  test("offers to boot or start every simulator", () => {
    const html = renderToStaticMarkup(
      <EmptyScene devices={devices} loading={false} error={null} onRefresh={() => {}} />,
    );
    expect(html).toContain("No simulator is streaming");
    expect(html).toContain("Start stream");
    expect(html.match(/Boot &amp; stream/g)?.length).toBe(3);
  });

  test("suggests the installed CLI for the likeliest device", () => {
    const html = renderToStaticMarkup(
      <EmptyScene devices={devices} loading={false} error={null} onRefresh={() => {}} />,
    );
    expect(html).toContain("headless-serve-sim --detach &quot;iPhone 17 Pro&quot;");
    expect(html).not.toContain("bunx");
    expect(detachCommand(null)).toBe('headless-serve-sim --detach "<device>"');
  });

  test("shows runtimes in readable form", () => {
    const html = renderToStaticMarkup(
      <EmptyScene
        devices={[sim("X", "iPhone Air", "Shutdown", "iOS.27.0")]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    expect(html).toContain("iOS 27.0");
    expect(html).not.toContain("iOS.27.0");
  });

  test("reports listing errors and an empty catalog", () => {
    expect(
      renderToStaticMarkup(
        <EmptyScene devices={[]} loading={false} error="simctl failed" onRefresh={() => {}} />,
      ),
    ).toContain("simctl failed");
    expect(
      renderToStaticMarkup(
        <EmptyScene devices={[]} loading={false} error={null} onRefresh={() => {}} />,
      ),
    ).toContain("No available simulators found");
  });
});
