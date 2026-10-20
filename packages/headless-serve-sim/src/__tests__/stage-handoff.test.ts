import { expect, test } from "bun:test";
import {
  flightStart,
  handOffStage,
  publishNavigatorLayout,
  publishStageLayout,
  stageArrival,
  stageArrived,
  takeStageHandoff,
} from "../client/shell/stage-handoff";

const layout = {
  navigatorOpen: true,
  inspectorOpen: false,
  inspectorTab: "app" as const,
  consoleOpen: true,
  consoleTab: "logs" as const,
  consoleHeight: 240,
};

test("the next shell takes the handoff once; a later mount starts fresh", () => {
  expect(takeStageHandoff()).toBeNull();
  handOffStage({ from: null, frame: null, layout });
  expect(takeStageHandoff()?.layout.inspectorTab).toBe("app");
  expect(takeStageHandoff()).toBeNull();
});

test("a switch that knows nothing else still carries the published layout", () => {
  handOffStage();
  expect(takeStageHandoff()).toBeNull();
  publishStageLayout(layout);
  handOffStage();
  expect(takeStageHandoff()).toEqual({
    from: null,
    frame: null,
    layout: { ...layout, navigator: { query: "", scrollTop: 0 } },
  });
});

test("the navigator's search and scroll ride along to the next shell", () => {
  publishStageLayout(layout);
  const leaving = {};
  publishNavigatorLayout(leaving, { query: "duo", scrollTop: 120 });
  handOffStage();
  expect(takeStageHandoff()?.layout.navigator).toEqual({ query: "duo", scrollTop: 120 });
  // The next shell's navigator takes over before the old one unmounts, so
  // the old one's leaving doesn't clear what the new one carries.
  const arriving = {};
  publishNavigatorLayout(arriving, { query: "duo", scrollTop: 120 });
  publishNavigatorLayout(leaving, null);
  handOffStage();
  expect(takeStageHandoff()?.layout.navigator).toEqual({ query: "duo", scrollTop: 120 });
  // Closing the navigator drops its search, as reopening it starts fresh.
  publishNavigatorLayout(arriving, null);
  handOffStage();
  expect(takeStageHandoff()?.layout.navigator).toEqual({ query: "", scrollTop: 0 });
});

test("the leaving shell waits until the next one has placed its device", async () => {
  publishStageLayout(layout);
  handOffStage();
  const arrival = stageArrival();
  let released: { solid: boolean } | null = null;
  void arrival?.then((how) => (released = how));
  await Promise.resolve();
  expect(released).toBeNull();
  takeStageHandoff();
  stageArrived({ solid: false });
  await Promise.resolve();
  // Whether the device is opaque where it takes off, so its tile can go.
  expect(released!).toEqual({ solid: false });
  // Once arrived there is nothing more to wait on.
  expect(stageArrival()).toBeNull();
});

test("a flight starts with the device over its tile", () => {
  const tile = { left: 20, top: 40, width: 50, height: 100 };
  const box = { left: 300, top: 100, width: 200, height: 400 };
  expect(flightStart(tile, box, { x: 0, y: 0, width: 200, height: 400 })).toEqual({
    x: 45 - 400,
    y: 90 - 300,
    scale: 0.25,
  });
});

test("a device drawn off its box's centre still lands on its tile", () => {
  // The Duo draws itself inside a larger box, which the flight scales about.
  const tile = { left: 0, top: 0, width: 100, height: 100 };
  const box = { left: 0, top: 0, width: 1000, height: 600 };
  const visible = { x: 100, y: 100, width: 400, height: 400 };
  const start = flightStart(tile, box, visible);
  // Where the visible device's centre lands once the box is scaled about its centre.
  const centre = {
    x: 500 + start.scale * (300 - 500) + start.x,
    y: 300 + start.scale * (300 - 300) + start.y,
  };
  expect(start.scale).toBe(0.25);
  expect(centre).toEqual({ x: 50, y: 50 });
});
