import { expect, test } from "bun:test";
import { handOffStage, publishStageLayout, takeStageHandoff } from "../client/shell/stage-handoff";

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
  handOffStage({ from: null, frame: "data:x", layout });
  expect(takeStageHandoff()?.layout.inspectorTab).toBe("app");
  expect(takeStageHandoff()).toBeNull();
});

test("a switch that knows nothing else still carries the published layout", () => {
  handOffStage();
  expect(takeStageHandoff()).toBeNull();
  publishStageLayout(layout);
  handOffStage();
  expect(takeStageHandoff()).toEqual({ from: null, frame: null, layout });
});
