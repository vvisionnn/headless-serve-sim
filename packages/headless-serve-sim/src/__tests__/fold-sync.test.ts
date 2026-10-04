import { expect, test } from "bun:test";
import { shouldApplyObservedHinge, observedDuoOrientation } from "../client/utils/fold-sync";

test("restores body orientation from native state without stale poll overwrites", () => {
  const expected = {
    portrait: "portrait",
    portraitUpsideDown: "portrait_upside_down",
    landscapeLeft: "landscape_right",
    landscapeRight: "landscape_left",
  } as const;
  for (const [physical, orientation] of Object.entries(expected)) {
    expect(observedDuoOrientation(physical, 3, 3, false)).toBe(orientation);
    expect(observedDuoOrientation(physical, 3, 4, false)).toBeNull();
    expect(observedDuoOrientation(physical, 3, 3, true)).toBeNull();
  }
  expect(observedDuoOrientation("faceUp", 3, 3, false)).toBeNull();
  expect(observedDuoOrientation("faceDown", 3, 3, false)).toBeNull();
  expect(observedDuoOrientation(null, 3, 3, false)).toBeNull();
  expect(observedDuoOrientation("landscapeLeft", 3, 3, false, "landscapeRight")).toBe(
    "landscape_left",
  );
  expect(observedDuoOrientation("portrait", 3, 3, false, "portraitUpsideDown")).toBe(
    "portrait_upside_down",
  );
});

test("does not apply sensor polling while a preset animation is in progress", () => {
  expect(
    shouldApplyObservedHinge({
      requestedRevision: 3,
      currentRevision: 3,
      pending: false,
      animating: true,
      angle: 40,
    }),
  ).toBe(false);
});

test("does not overwrite a newer slider gesture with stale observed angle", () => {
  expect(
    shouldApplyObservedHinge({
      requestedRevision: 1,
      currentRevision: 2,
      pending: false,
      angle: 20,
    }),
  ).toBe(false);
  expect(
    shouldApplyObservedHinge({
      requestedRevision: 1,
      currentRevision: 1,
      pending: true,
      angle: 20,
    }),
  ).toBe(false);
  expect(
    shouldApplyObservedHinge({
      requestedRevision: 2,
      currentRevision: 2,
      pending: false,
      angle: 130,
    }),
  ).toBe(true);
});
